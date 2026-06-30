import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { useAuth } from "../context/AuthContext.jsx";
import { getRoom, getChatHistory, getHistory } from "../api/rooms.js";
import { executeCode } from "../api/execute.js";
import socket from "../socket/socket.js";
import ReplayControls from "../components/ReplayControls.jsx";

const LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python" },
  { value: "cpp", label: "C++" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
];

// Consistent color per user — hash the userId into a fixed palette.
const CURSOR_COLORS = [
  "#F44747",
  "#6A9955",
  "#DCDCAA",
  "#4EC9B0",
  "#C678DD",
  "#61AFEF",
];

const colorForUser = (userId) => {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
};

const Room = () => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [room, setRoom] = useState(null);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("javascript");
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Execution state
  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");

  // Remote cursors: { userId -> { position: {lineNumber, column} } }
  const [remoteCursors, setRemoteCursors] = useState({});

  // Chat state
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const messagesEndRef = useRef(null);

  // Replay state. While replaying, the editor is read-only and shows the code
  // snapshot at `replayIndex` instead of the live code.
  const [replayMode, setReplayMode] = useState(false);
  const [replayEvents, setReplayEvents] = useState([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);

  // Monaco refs
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationIdsRef = useRef([]);
  // True while we're applying a remote code_update via executeEdits.
  // executeEdits fires Monaco's content-change event synchronously, so we
  // use this to skip re-emitting that change back to the room (echo loop).
  const isApplyingRemoteEdit = useRef(false);
  // Mirrors replayMode for the socket-handler closures (which capture stale
  // state). While replaying we hold remote edits in `code` state without
  // touching the editor, so they apply cleanly the moment replay exits.
  const replayModeRef = useRef(false);
  useEffect(() => {
    replayModeRef.current = replayMode;
  }, [replayMode]);

  // Load room details from REST API
  useEffect(() => {
    const loadRoom = async () => {
      try {
        const data = await getRoom(roomId);
        setRoom(data);
        // Language comes from room_state (socket) — the live source of truth.
        // Setting it here would race the socket and clobber it with the
        // stale MongoDB default.
      } catch (err) {
        setError(err.response?.data?.message || "Failed to load room");
      } finally {
        setLoading(false);
      }
    };
    loadRoom();
  }, [roomId]);

  // Load chat history (last 50 messages) on room change
  useEffect(() => {
    const loadChat = async () => {
      try {
        const history = await getChatHistory(roomId);
        setMessages(history || []);
      } catch {
        // Non-fatal — chat just starts empty if history can't load.
      }
    };
    loadChat();
  }, [roomId]);

  // Join room via Socket.IO
  useEffect(() => {
    if (!user) return;

    socket.emit("join_room", {
      roomId,
      userId: user._id,
      username: user.name,
    });

    const handleRoomState = (data) => {
      console.log("room_state received:", data);
      const {
        code: initialCode,
        language: initialLang,
        users: initialUsers,
      } = data;
      setCode(initialCode);
      setLanguage(initialLang);
      setOnlineUsers(
        (initialUsers || []).filter((u) => u.userId !== user._id)
      );
    };

    const handleCodeUpdate = ({ code: newCode }) => {
      // During replay the editor is showing a historical snapshot. Keep the
      // live code in state (so it's current on exit) but don't disturb the view.
      if (replayModeRef.current) {
        setCode(newCode);
        return;
      }
      const editor = editorRef.current;
      if (!editor) {
        setCode(newCode);
        return;
      }
      const model = editor.getModel();
      if (model) {
        // Apply the remote change as an edit rather than a full value reset,
        // which preserves the local user's cursor position.
        isApplyingRemoteEdit.current = true;
        const fullRange = model.getFullModelRange();
        editor.executeEdits("remote-update", [
          {
            range: fullRange,
            text: newCode,
            forceMoveMarkers: false,
          },
        ]);
        isApplyingRemoteEdit.current = false;
      }
    };

    const handleLanguageUpdated = ({ language: newLang }) => {
      setLanguage(newLang);
    };

    const handleUserJoined = ({ userId, username }) => {
      setOnlineUsers((prev) => [...prev, { userId, username }]);
    };

    const handleUserLeft = ({ userId }) => {
      setOnlineUsers((prev) => prev.filter((u) => u.userId !== userId));
      // Drop their cursor too
      setRemoteCursors((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    };

    const handleCursorUpdate = ({ userId, position }) => {
      if (userId === user._id) return;
      setRemoteCursors((prev) => ({
        ...prev,
        [userId]: { position },
      }));
    };

    const handleChatMessage = (msg) => {
      setMessages((prev) => [...prev, msg]);
    };

    const handleRoomFull = () => {
      alert("Room is full");
      navigate("/dashboard");
    };

    socket.on("room_state", handleRoomState);
    socket.on("room_full", handleRoomFull);
    socket.on("code_update", handleCodeUpdate);
    socket.on("language_updated", handleLanguageUpdated);
    socket.on("user_joined", handleUserJoined);
    socket.on("user_left", handleUserLeft);
    socket.on("cursor_update", handleCursorUpdate);
    socket.on("chat_message", handleChatMessage);

    return () => {
      socket.emit("leave_room", { roomId, userId: user._id });
      socket.off("room_state", handleRoomState);
      socket.off("room_full", handleRoomFull);
      socket.off("code_update", handleCodeUpdate);
      socket.off("language_updated", handleLanguageUpdated);
      socket.off("user_joined", handleUserJoined);
      socket.off("user_left", handleUserLeft);
      socket.off("cursor_update", handleCursorUpdate);
      socket.off("chat_message", handleChatMessage);
    };
  }, [roomId, user]);

  // Debounced code change emitter (100ms)
  const emitCodeChange = useCallback(
    debounce((newCode) => {
      socket.emit("code_change", {
        roomId,
        code: newCode,
        userId: user?._id,
      });
    }, 100),
    [roomId, user]
  );

  const handleEditorChange = (value) => {
    // Replay swaps the editor value to historical snapshots; ignore those
    // programmatic changes so we never persist or broadcast them.
    if (replayMode) return;
    setCode(value || "");
    // executeEdits (remote apply) fires this synchronously — don't echo it back.
    if (isApplyingRemoteEdit.current) return;
    emitCodeChange(value || "");
  };

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Emit local cursor moves to the room
    editor.onDidChangeCursorPosition((e) => {
      socket.emit("cursor_move", {
        roomId,
        userId: user?._id,
        position: {
          lineNumber: e.position.lineNumber,
          column: e.position.column,
        },
      });
    });
  };

  const handleLanguageChange = (e) => {
    const newLang = e.target.value;
    setLanguage(newLang);
    socket.emit("language_change", { roomId, language: newLang });
  };

  const handleRun = async () => {
    setRunning(true);
    setRunError("");
    setOutput(null);
    try {
      const result = await executeCode({ code, language, stdin });
      setOutput(result);
    } catch (err) {
      setRunError(
        err.response?.data?.message ||
          err.response?.data?.error ||
          "Execution failed"
      );
    } finally {
      setRunning(false);
    }
  };

  // Enter replay: fetch the recorded snapshots and pause live editing.
  const handleStartReplay = async () => {
    try {
      const events = await getHistory(roomId);
      if (!events || events.length === 0) {
        alert("No session history recorded yet — edit some code first.");
        return;
      }
      setReplayEvents(events);
      setReplayIndex(events.length - 1);
      setReplayPlaying(false);
      setReplayMode(true);
    } catch {
      alert("Failed to load session history.");
    }
  };

  const handleExitReplay = () => {
    setReplayMode(false);
    setReplayPlaying(false);
  };

  // Promote the currently-viewed snapshot to the room's live code. Emitting
  // code_change persists it server-side and broadcasts to every collaborator.
  const handleRestoreSnapshot = () => {
    const snapshot = replayEvents[replayIndex];
    if (!snapshot) return;
    setCode(snapshot.code);
    socket.emit("code_change", {
      roomId,
      code: snapshot.code,
      userId: user?._id,
    });
    handleExitReplay();
  };

  // Auto-advance while playing; stop at the final snapshot.
  useEffect(() => {
    if (!replayMode || !replayPlaying) return;
    if (replayIndex >= replayEvents.length - 1) {
      setReplayPlaying(false);
      return;
    }
    const timer = setTimeout(() => setReplayIndex((i) => i + 1), 700);
    return () => clearTimeout(timer);
  }, [replayMode, replayPlaying, replayIndex, replayEvents.length]);

  const handleSendMessage = () => {
    const text = chatInput.trim();
    if (!text) return;
    socket.emit("chat_message", {
      roomId,
      userId: user._id,
      username: user.name,
      message: text,
    });
    setChatInput("");
  };

  // Enter sends, Shift+Enter inserts a newline.
  const handleChatKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Auto-scroll the chat to the newest message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Render remote cursors as Monaco decorations whenever they change.
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    const monaco = monacoRef.current;
    const decorations = [];
    let css = "";

    Object.entries(remoteCursors).forEach(([userId, { position }]) => {
      if (!position) return;
      const username =
        onlineUsers.find((u) => u.userId === userId)?.username || "User";
      const color = colorForUser(userId);
      const cls = `remote-cursor-${userId}`;

      decorations.push({
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column
        ),
        options: {
          beforeContentClassName: cls,
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });

      // Colored vertical caret + username label above it
      const safeName = username.replace(/["'\\<>]/g, "");
      css += `
        .${cls} {
          border-left: 2px solid ${color};
          position: relative;
          margin-left: -1px;
          z-index: 10;
        }
        .${cls}::after {
          content: "${safeName}";
          position: absolute;
          top: -15px;
          left: -1px;
          background: ${color};
          color: #fff;
          font-size: 11px;
          line-height: 15px;
          padding: 0 4px;
          border-radius: 3px 3px 3px 0;
          white-space: nowrap;
          pointer-events: none;
          font-family: system-ui, sans-serif;
        }
      `;
    });

    // Inject/update a single stylesheet for all remote cursor labels
    let styleEl = document.getElementById("remote-cursor-styles");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "remote-cursor-styles";
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = css;

    decorationIdsRef.current = editorRef.current.deltaDecorations(
      decorationIdsRef.current,
      decorations
    );
  }, [remoteCursors, onlineUsers]);

  if (loading) return <div style={{ padding: 40 }}>Loading room…</div>;
  if (error) return <div style={{ padding: 40, color: "#f87171" }}>{error}</div>;

  return (
    <div className="room-container">
      <header className="room-header">
        <div>
          <button className="secondary" onClick={() => navigate("/dashboard")}>
            ← Back
          </button>
          <h2 style={{ marginLeft: 16, display: "inline" }}>{room?.name}</h2>
        </div>
        <div className="header-controls">
          <button
            className="secondary"
            onClick={handleStartReplay}
            disabled={replayMode}
            title="Scrub through this session's history"
          >
            ⏱ Replay
          </button>
          <div className="language-selector">
            <label htmlFor="language">Language:</label>
            <select
              id="language"
              value={language}
              onChange={handleLanguageChange}
              disabled={replayMode}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <div className="room-content">
        <div className="main-section">
          {replayMode && (
            <ReplayControls
              events={replayEvents}
              index={replayIndex}
              isPlaying={replayPlaying}
              onSeek={(i) => {
                setReplayPlaying(false);
                setReplayIndex(i);
              }}
              onTogglePlay={() => setReplayPlaying((p) => !p)}
              onRestore={handleRestoreSnapshot}
              onExit={handleExitReplay}
            />
          )}
          <div className="editor-section">
            <Editor
              height="100%"
              language={language}
              value={replayMode ? replayEvents[replayIndex]?.code ?? "" : code}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              theme="vs-dark"
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                readOnly: replayMode,
              }}
            />
          </div>

          <div className="output-panel">
            <div className="output-controls">
              <div className="stdin-group">
                <label htmlFor="stdin">Input</label>
                <textarea
                  id="stdin"
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  placeholder="stdin…"
                  rows={3}
                />
              </div>
              <button onClick={handleRun} disabled={running}>
                {running ? "Running…" : "▶ Run Code"}
              </button>
            </div>

            <div className="output-display">
              {runError && <pre className="error">{runError}</pre>}
              {running && <p className="muted">Executing on Judge0…</p>}
              {output && !running && (
                <>
                  <div className="output-meta">
                    <span>
                      Status: <strong>{output.status || "—"}</strong>
                    </span>
                    <span>Exit: {output.exitCode ?? "—"}</span>
                    <span>Time: {output.time ?? "—"}s</span>
                    <span>Memory: {output.memory ?? "—"} KB</span>
                  </div>
                  {output.stdout && (
                    <pre className="stdout">{output.stdout}</pre>
                  )}
                  {output.stderr && (
                    <pre className="stderr">{output.stderr}</pre>
                  )}
                  {!output.stdout && !output.stderr && (
                    <p className="muted">No output.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <aside className="sidebar">
          <div className="users-panel">
            <h3>Online ({onlineUsers.length + 1})</h3>
            <ul className="user-list">
              <li>
                <span
                  className="user-dot"
                  style={{ background: colorForUser(user?._id || "") }}
                />
                <strong>{user?.name}</strong> (you)
              </li>
              {onlineUsers.map((u) => (
                <li key={u.userId}>
                  <span
                    className="user-dot"
                    style={{ background: colorForUser(u.userId) }}
                  />
                  {u.username}
                </li>
              ))}
            </ul>
          </div>

          <div className="chat-panel">
            <h3>Chat</h3>
            <div className="chat-messages">
              {messages.map((msg, i) => (
                <div key={i} className="chat-message">
                  <div className="chat-message-head">
                    <span
                      className="chat-username"
                      style={{ color: colorForUser(msg.userId || "") }}
                    >
                      {msg.username}
                    </span>
                    <span className="chat-time">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="chat-text">{msg.message}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="chat-input-row">
              <textarea
                className="chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="Type a message…"
                rows={2}
              />
              <button onClick={handleSendMessage} disabled={!chatInput.trim()}>
                Send
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

// Simple debounce utility (inline, no lodash needed)
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export default Room;
