
import threading

from app.approval import ApprovalManager


class _ApprovalManagerTest:
    def test_agent_waits_until_user_decides_and_receives_rejection(self):
        # Arrange: create the manager and register a file-change request.
        manager = ApprovalManager()

        request_id = manager.create_request(
            action="create_file",
            details={"path": "example.txt"},
        )

        result = []
        agent_finished = threading.Event()

        def wait_for_approval():
            # The agent waits until the user makes a decision.
            result.append(manager.wait_for_decision(request_id))
            agent_finished.set()

        agent_thread = threading.Thread(target=wait_for_approval)
        agent_thread.start()

        try:
            # The agent must not finish before a decision arrives.
            assert not agent_finished.wait(timeout=0.1)

            # Reject the requested file change.
            manager.resolve(request_id, approved=False)

            # Verify that the agent receives the rejection.
            assert agent_finished.wait(timeout=1)
            assert result == [False]
        finally:
            # Ensure the thread cannot remain blocked after a failure.
            manager.resolve(request_id, approved=False)
            agent_thread.join(timeout=1)

    def test_pending_requests_returns_unresolved_requests(self):
        manager = ApprovalManager()

        request_id = manager.create_request(
            action="delete_file",
            details={"path": "example.txt"},
        )

        pending = manager.pending_requests()

        assert len(pending) == 1
        assert pending[0] == {
            "request_id": request_id,
            "action": "delete_file",
            "details": {"path": "example.txt"},
        }
