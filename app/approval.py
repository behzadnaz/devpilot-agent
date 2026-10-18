import threading
import uuid


class ApprovalManager:
    """Create approval requests and wait for user decisions."""

    def __init__(self):
        # Protect shared request data when the web server and agent
        # access it from different threads.
        self._lock = threading.Lock()
        self._requests = {}

    def create_request(self, action, details):
        """Register a pending approval request and return its ID."""
        request_id = str(uuid.uuid4())

        # Each request has its own event so an agent can wait for
        # its specific decision without blocking other requests.
        with self._lock:
            self._requests[request_id] = {
                "action": action,
                "details": details,
                "approved": None,
                "event": threading.Event(),
            }

        return request_id

    def wait_for_decision(self, request_id):
        """Block until the request is approved or rejected."""
        with self._lock:
            request = self._requests.get(request_id)

            if request is None:
                raise KeyError(f"Unknown approval request: {request_id}")

            decision_event = request["event"]

        # Wait outside the lock so another thread can resolve the request.
        decision_event.wait()

        with self._lock:
            return self._requests[request_id]["approved"]

    def resolve(self, request_id, approved):
        """Record the user's decision and wake the waiting agent."""
        with self._lock:
            request = self._requests.get(request_id)

            if request is None:
                raise KeyError(f"Unknown approval request: {request_id}")

            # Once resolved, a request cannot be changed to the opposite
            # decision by a later submission.
            if request["approved"] is not None:
                return

            request["approved"] = bool(approved)
            request["event"].set()

    def pending_requests(self):
        """Return approval requests that are still awaiting a decision."""
        with self._lock:
            return [
                {
                    "request_id": request_id,
                    "action": request["action"],
                    "details": request["details"],
                }
                for request_id, request in self._requests.items()
                if request["approved"] is None
            ]

