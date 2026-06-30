// Scrubber + transport controls for session replay. Stateless — the parent
// (Room) owns the events array and current index; this just renders controls
// and reports user intent back up.
const ReplayControls = ({
  events,
  index,
  isPlaying,
  onSeek,
  onTogglePlay,
  onRestore,
  onExit,
}) => {
  const total = events.length;
  const current = events[index];
  const atEnd = index >= total - 1;

  return (
    <div className="replay-bar">
      <div className="replay-transport">
        <button
          className="secondary"
          onClick={onTogglePlay}
          disabled={total === 0}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "❚❚ Pause" : "▶ Play"}
        </button>

        <input
          type="range"
          className="replay-scrubber"
          min={0}
          max={Math.max(total - 1, 0)}
          value={index}
          onChange={(e) => onSeek(Number(e.target.value))}
          disabled={total === 0}
        />

        <span className="replay-position">
          {total === 0 ? "0 / 0" : `${index + 1} / ${total}`}
        </span>
      </div>

      <div className="replay-meta">
        {current ? (
          <>
            <span className="replay-author">{current.username}</span>
            <span className="replay-time">
              {new Date(current.timestamp).toLocaleString()}
            </span>
          </>
        ) : (
          <span className="muted">No snapshots recorded yet.</span>
        )}
      </div>

      <div className="replay-actions">
        <button
          onClick={onRestore}
          disabled={!current}
          title="Make this snapshot the room's live code for everyone"
        >
          Restore this snapshot
        </button>
        <button className="secondary" onClick={onExit}>
          Exit replay
        </button>
      </div>
    </div>
  );
};

export default ReplayControls;
