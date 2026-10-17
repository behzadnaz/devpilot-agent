import threading
from app.approval import ApprovalManager


class TestApprovalManager:
    def test_agent_waits_until_user_decides_and_receives_rejection(self):
        # Arrange: create the manager and register a file-change request.
        manager = ApprovalManager()

        request_id = manager.create_request(
            action="create_file",
            details={"path": "example.txt"},
        )

        # Store the agent's result so the test can verify its decision.
        result = []
        agent_finished = threading.Event()

        def wait_for_approval():
            # The agent must wait until a decision is available.
            result.append(manager.wait_for_decision(request_id))
            agent_finished.set()

        # Act: simulate the agent waiting for the user's decision.
        agent_thread = threading.Thread(target=wait_for_approval)
        agent_thread.start()

        try:
            # Assert: the agent must not finish before a decision arrives.
            assert not agent_finished.wait(timeout=0.1)

            # Reject the requested file change.
            manager.resolve(request_id, approved=False)

            # The agent should receive the rejection and finish.
            assert agent_finished.wait(timeout=1)
            assert result == [False]
        finally:
            # Prevent a failed assertion from leaving a thread blocked.
            manager.resolve(request_id, approved=False)
            agent_thread.join(timeout=1)

    def test_pending_requests_returns_unresolved_requests(self):
        manager = ApprovalManager()

        request_id = manager.create_request(
            "delete_file",
            {"path": "example.txt"},
        )

        pending = manager.pending_requests()

        assert len(pending) == 1
        assert pending[0] == {
            "request_id": request_id,
            "action": "delete_file",
            "details": {"path": "example.txt"},
        }


