import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import {
  createRoom,
  getMyRooms,
  deleteRoom,
} from "../api/rooms.js";

const Dashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // roomId whose link was just copied, for a brief per-card confirmation.
  const [copiedId, setCopiedId] = useState("");

  const loadRooms = async () => {
    try {
      const data = await getMyRooms();
      setRooms(data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load rooms");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRooms();
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const name = window.prompt("Room name?", "Untitled Room");
      if (name === null) return; // user cancelled
      const room = await createRoom({ name: name || "Untitled Room" });
      navigate(`/room/${room.roomId}`);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create room");
    } finally {
      setCreating(false);
    }
  };

  const handleCopyLink = async (e, roomId) => {
    e.stopPropagation(); // don't trigger the card's navigate
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(roomId);
      setTimeout(() => setCopiedId(""), 2000);
    } catch {
      // Clipboard API can fail (e.g. non-secure context) — ignore silently.
    }
  };

  const handleDelete = async (e, roomId) => {
    e.stopPropagation(); // don't trigger the card's navigate
    if (!window.confirm("Delete this room?")) return;
    try {
      await deleteRoom(roomId);
      setRooms((prev) => prev.filter((r) => r.roomId !== roomId));
    } catch (err) {
      setError(err.response?.data?.message || "Failed to delete room");
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Signed in as {user?.name}</p>
        </div>
        <div className="header-actions">
          <button onClick={handleCreate} disabled={creating}>
            {creating ? "Creating…" : "+ Create Room"}
          </button>
          <button className="secondary" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">Loading rooms…</p>
      ) : rooms.length === 0 ? (
        <p className="muted">No rooms yet — create your first one.</p>
      ) : (
        <div className="room-grid">
          {rooms.map((room) => (
            <div
              key={room.roomId}
              className="room-card"
              onClick={() => navigate(`/room/${room.roomId}`)}
            >
              <div className="room-card-top">
                <h3>{room.name}</h3>
                <span className={`badge ${room.isLocked ? "locked" : "open"}`}>
                  {room.isLocked ? "🔒 Locked" : "🔓 Open"}
                </span>
              </div>
              <p className="muted">Language: {room.language}</p>
              <p className="muted">
                Created: {new Date(room.createdAt).toLocaleDateString()}
              </p>
              <div className="room-card-actions">
                <button
                  className="secondary"
                  onClick={(e) => handleCopyLink(e, room.roomId)}
                  title="Copy room link"
                >
                  {copiedId === room.roomId ? "✓ Copied!" : "🔗 Copy Link"}
                </button>
                <button
                  className="danger"
                  onClick={(e) => handleDelete(e, room.roomId)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Dashboard;
