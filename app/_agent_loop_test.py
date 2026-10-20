from app._llm_stub import _LLMStub, final_message, tool_call
from app.agent_loop import AgentLoop
from app.events import Event, EventStream
from app.reply_parser import ReplyParser
from app.tools import ToolSet

REQUIRED = {"list_files": [], "read_file": ["path"], "create_file": ["path", "content"], "edit_file": ["path", "old_text", "new_text"],}


def _new_loop(tmp_path, messages, **options):
    llm = _LLMStub(messages)
    loop = AgentLoop(
        llm,
        ToolSet(tmp_path),
        ReplyParser(REQUIRED),
        tool_schemas=[],
        system_prompt="You are a coding agent.",
        **options,
    )
    return loop, llm


class _AgentLoopTest:
    def test_one_step_makes_one_llm_call_and_runs_one_tool_call(self, tmp_path):
        (tmp_path / "hello.py").write_text("print(1)\n")
        loop, llm = _new_loop(tmp_path, [tool_call("list_files"), final_message("Done.")])
        events = EventStream()

        loop.run("Look at the project", events)

        published = events.since(0)
        results = [event for event in published if event.type == "tool_result"]
        assert len(llm.calls) == 2, "one model call for the tool call and one for the final message"
        assert [event.type for event in published if event.type == "tool_call"] == ["tool_call"], "the tool call is published"
        assert results[0].text == "hello.py", "the result is what the tool returned"
        assert published[-1] == Event("message", "Done."), "the run ends with the final message"

    def test_result_is_added_to_the_history_and_the_loop_repeats(self, tmp_path):
        (tmp_path / "hello.py").write_text("print(1)\n")
        loop, llm = _new_loop(tmp_path, [tool_call("list_files"), final_message("Done.")])

        loop.run("Look at the project", EventStream())

        first, second = llm.calls[0]["messages"], llm.calls[1]["messages"]
        assert len(second) == len(first) + 2, "the second call has the model message and the tool result in addition"
        assert second[-1] == {"role": "tool", "tool_name": "list_files", "content": "hello.py"}, "the tool result"
        assert second[-2]["role"] == "assistant", "the model message before it"

    def test_status_event_carries_the_step_out_of_the_step_limit(self, tmp_path):
        loop, _ = _new_loop(tmp_path, [final_message("Done.")], max_steps=3)
        events = EventStream()

        loop.run("Do nothing", events)

        assert events.since(0)[0] == Event("status", "step 1 of 3"), "the first step out of the step limit"

    def test_final_message_ends_the_task_with_status_done(self, tmp_path):
        loop, _ = _new_loop(tmp_path, [final_message("All finished.")])
        events = EventStream()

        loop.run("Do nothing", events)

        assert events.since(0)[-2:] == [Event("status", "done"), Event("message", "All finished.")], "status done, then the summary"

    def test_bad_reply_is_not_run(self, tmp_path):
        loop, _ = _new_loop(tmp_path, [tool_call("format_disk", path="c:")])
        events = EventStream()

        loop.run("Try something wrong", events)

        assert "tool_call" not in [event.type for event in events.since(0)], "no tool call is published or run"

    def test_bad_reply_stops_the_task_and_shows_the_reason(self, tmp_path):
        loop, llm = _new_loop(tmp_path, [tool_call("format_disk", path="c:"), final_message("Never reached.")])
        events = EventStream()

        loop.run("Try something wrong", events)

        published = events.since(0)
        assert len(llm.calls) == 1, "the loop does not ask again"
        assert published[-2] == Event("status", "failed"), "the status"
        assert "Unknown tool: format_disk" in published[-1].text, "the page shows the reason"

    def test_the_loop_makes_no_more_model_calls_than_the_step_limit(self, tmp_path):
        loop, llm = _new_loop(tmp_path, [tool_call("list_files") for _ in range(3)], max_steps=3)

        loop.run("Never finish", EventStream())

        assert len(llm.calls) == 3, "exactly the step limit"

    def test_ask_mode_does_not_create_files(self, tmp_path):
        target = tmp_path / "should_not_exist.py"
        loop, _ = _new_loop(
            tmp_path,
            [
                tool_call(
                    "create_file",
                    path="should_not_exist.py",
                    content="print('changed')",
                ),
                final_message("I can answer without changing files."),
            ],
        )
        events = EventStream()

        loop.run(
            "Create a file",
            events,
            mode="ask",
            tags=["ask"],
        )

        assert not target.exists(), "Ask mode must not create files"

    def test_ask_mode_does_not_edit_files(self, tmp_path):
        target = tmp_path / "existing.py"
        target.write_text("print('original')")

        loop, _ = _new_loop(
            tmp_path,
            [
                tool_call(
                    "edit_file",
                    path="existing.py",
                    old_text="original",
                    new_text="changed",
                ),
                final_message("I can answer without changing files."),
            ],
        )
        events = EventStream()

        loop.run(
            "Change the file",
            events,
            mode="ask",
            tags=["ask"],
        )

        assert target.read_text() == "print('original')"

    def test_ask_mode_does_not_move_files(self, tmp_path):
        source = tmp_path / "original.py"
        destination = tmp_path / "renamed.py"
        source.write_text("print('original')")

        loop, _ = _new_loop(
            tmp_path,
            [
                tool_call(
                    "move_file",
                    source="original.py",
                    destination="renamed.py",
                ),
                final_message("I can answer without changing files."),
            ],
        )
        events = EventStream()

        loop.run(
            "Move the file",
            events,
            mode="ask",
            tags=["ask"],
        )

        assert source.exists()
        assert not destination.exists()

    def test_ask_mode_does_not_delete_files(self, tmp_path):
        target = tmp_path / "important.py"
        target.write_text("print('keep this file')")

        loop, _ = _new_loop(
            tmp_path,
            [
                tool_call("delete_file", path="important.py"),
                final_message("I can answer without changing files."),
            ],
        )
        events = EventStream()

        loop.run(
            "Delete the file",
            events,
            mode="ask",
            tags=["ask"],
        )

        assert target.exists()
        assert target.read_text() == "print('keep this file')"

    def test_ask_mode_does_not_run_commands(self, tmp_path):
        target = tmp_path / "command_created.txt"

        loop, _ = _new_loop(
            tmp_path,
            [
                tool_call(
                    "run_command",
                    command="python -c \"from pathlib import Path; Path('command_created.txt').write_text('changed')\"",
                ),
                final_message("I can answer without changing files."),
            ],
        )
        events = EventStream()

        loop.run(
            "Create a file using a command",
            events,
            mode="ask",
            tags=["ask"],
        )

        assert not target.exists()