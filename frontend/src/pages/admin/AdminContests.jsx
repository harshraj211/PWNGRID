/**
 * AdminContests.jsx
 * Full CRUD for contests — accessible to admin + moderator.
 *
 * File location: frontend/src/pages/admin/AdminContests.jsx
 */
import { useState, useEffect, useRef } from "react";
import {
  collection, query, onSnapshot, orderBy,
  doc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, getDocs, where, Timestamp,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { uploadToCloudinary } from "../../lib/cloudinary";
import { hashAnswer } from "../../lib/hashAnswer";
import { useAuth } from "../../context/AuthContext";
import "./AdminChallenges.css"; // reuse challenge admin styles

const DIFFICULTIES = ["easy", "medium", "hard", "mixed"];
const CHALLENGE_DIFFICULTIES = ["easy", "medium", "hard"];
const CATEGORIES = [
  "search","domain-recon","image-osint","metadata","network-osint",
  "social-media","web-archive","geolocation","code-recon",
  "dark-web","tools","people-search","data-breach","other",
];
const MEDIA_TYPES = ["none","image","video","audio","file"];
const CHALLENGE_TYPES = ["standard", "investigation"];

const EMPTY_CHALLENGE = {
  title: "", description: "", type: "standard",
  difficulty: "easy", category: "search", basePoints: 100,
  tags: "", flag: "", flagFormat: "", hints: [""],
  timeLimit: "", mediaType: "none", mediaURL: "",
};

const EMPTY_FORM = {
  title: "",
  description: "",
  difficulty: "mixed",
  startTime: "",
  endTime: "",
  registrationDeadline: "",
  maxParticipants: "",
  prizeDescription: "",
  challengeIds: [],
  contestType: "public",
  accessCode: "",
};

function toLocalDatetime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminContests() {
  const { isAdmin, isMod, userProfile } = useAuth();
  const canManage = isAdmin || isMod || userProfile?.role === "contest_mod";
  const [contests, setContests] = useState([]);
  const [challenges, setChallenges] = useState([]); // for challenge picker
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | "create" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Inline challenge creator state
  const [showChallengeForm, setShowChallengeForm] = useState(false);
  const [challengeForm, setChallengeForm] = useState(EMPTY_CHALLENGE);
  const [savingChallenge, setSavingChallenge] = useState(false);
  const [challengeError, setChallengeError] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileRef = useRef();

  // Listen to contests
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "contests"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setContests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(`Load failed: ${err.message}`);
        setLoading(false);
      }
    );
    return unsub;
  }, []);

  // Load challenges for the picker (include contest-only ones)
  useEffect(() => {
    getDocs(
      query(collection(db, "challenges"), where("isDeleted", "==", false))
    ).then((snap) => {
      setChallenges(
        snap.docs.map((d) => ({
          id: d.id,
          title: d.data().title,
          difficulty: d.data().difficulty,
          visibility: d.data().visibility,
        }))
      );
    });
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setError("");
    setModal("create");
  }

  function openEdit(c) {
    setForm({
      title: c.title || "",
      description: c.description || "",
      difficulty: c.difficulty || "mixed",
      startTime: toLocalDatetime(c.startTime),
      endTime: toLocalDatetime(c.endTime),
      registrationDeadline: toLocalDatetime(c.registrationDeadline),
      maxParticipants: c.maxParticipants || "",
      prizeDescription: c.prizeDescription || "",
      challengeIds: c.challengeIds || [],
      contestType: c.contestType || "public",
      accessCode: c.accessCode || "",
    });
    setEditTarget(c);
    setError("");
    setModal("edit");
  }

  function closeModal() {
    setModal(null);
    setEditTarget(null);
  }

  function setField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleChallenge(id) {
    setForm((f) => {
      const ids = f.challengeIds.includes(id)
        ? f.challengeIds.filter((x) => x !== id)
        : [...f.challengeIds, id];
      return { ...f, challengeIds: ids };
    });
  }

  // ── Inline challenge creator helpers ──────────────────────────────────────
  function setCField(k, v) { setChallengeForm((f) => ({ ...f, [k]: v })); }
  function setCHint(i, v) {
    setChallengeForm((f) => { const h = [...f.hints]; h[i] = v; return { ...f, hints: h }; });
  }
  function addCHint() { setChallengeForm((f) => ({ ...f, hints: [...f.hints, ""] })); }
  function removeCHint(i) { setChallengeForm((f) => ({ ...f, hints: f.hints.filter((_, j) => j !== i) })); }

  function openNewChallenge() {
    setChallengeForm(EMPTY_CHALLENGE);
    setChallengeError("");
    setUploadProgress(0);
    setShowChallengeForm(true);
  }

  async function handleSaveChallenge() {
    setChallengeError("");
    if (!challengeForm.title.trim()) { setChallengeError("Title is required."); return; }
    if (!challengeForm.description.trim()) { setChallengeError("Description is required."); return; }
    if (!challengeForm.flag.trim()) { setChallengeError("Flag is required."); return; }

    setSavingChallenge(true);
    try {
      let mediaURL = challengeForm.mediaURL;
      let mediaFilename = null;
      if (fileRef.current?.files[0]) {
        const result = await uploadToCloudinary(fileRef.current.files[0], {
          folder: "osint-arena/challenges",
          onProgress: setUploadProgress,
        });
        mediaURL = result.url;
        mediaFilename = fileRef.current.files[0].name;
      }

      const tags = challengeForm.tags.split(",").map((t) => t.trim()).filter(Boolean);
      const hints = challengeForm.hints.filter((h) => h.trim());

      const slug = challengeForm.title.trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      const data = {
        title: challengeForm.title.trim(),
        description: challengeForm.description.trim(),
        type: challengeForm.type,
        difficulty: challengeForm.difficulty,
        category: challengeForm.category,
        basePoints: Number(challengeForm.basePoints) || 100,
        tags,
        visibility: "contest",          // hidden until contest ends
        hints,
        timeLimit: challengeForm.timeLimit ? Number(challengeForm.timeLimit) : null,
        mediaType: challengeForm.mediaType,
        mediaURL: mediaURL || null,
        mediaFilename: mediaFilename,
        flagFormat: challengeForm.flagFormat.trim() || null,
        isActive: false,                 // not publicly active
        freeForAll: false,
        isFreeThisWeek: false,
        answerHash: await hashAnswer(challengeForm.flag.trim().toLowerCase()),
        rawFlag: challengeForm.flag.trim(),
        slug,
        isDeleted: false,
        solveCount: 0,
        attemptCount: 0,
        createdAt: serverTimestamp(),
        createdBy: userProfile?.uid || "",
        updatedAt: serverTimestamp(),
        updatedBy: userProfile?.uid || "",
      };

      const docRef = await addDoc(collection(db, "challenges"), data);

      // Add new challenge to picker + select it
      setChallenges((prev) => [...prev, { id: docRef.id, title: data.title, difficulty: data.difficulty, visibility: "contest" }]);
      setForm((f) => ({ ...f, challengeIds: [...f.challengeIds, docRef.id] }));

      setShowChallengeForm(false);
      setChallengeForm(EMPTY_CHALLENGE);
      setUploadProgress(0);
    } catch (err) {
      setChallengeError("Save failed: " + err.message);
    } finally {
      setSavingChallenge(false);
    }
  }

  async function handleSave() {
    setError("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.startTime) { setError("Start time is required."); return; }
    if (!form.endTime) { setError("End time is required."); return; }
    if (new Date(form.endTime) <= new Date(form.startTime)) {
      setError("End time must be after start time.");
      return;
    }
    if (form.challengeIds.length === 0) {
      setError("Select at least one challenge.");
      return;
    }

    setSaving(true);
    try {
      const data = {
        title: form.title.trim(),
        description: form.description.trim(),
        difficulty: form.difficulty,
        startTime: Timestamp.fromDate(new Date(form.startTime)),
        endTime: Timestamp.fromDate(new Date(form.endTime)),
        registrationDeadline: form.registrationDeadline
          ? Timestamp.fromDate(new Date(form.registrationDeadline))
          : Timestamp.fromDate(new Date(form.startTime)),
        maxParticipants: form.maxParticipants ? Number(form.maxParticipants) : null,
        prizeDescription: form.prizeDescription.trim() || null,
        contestType: form.contestType || "public",
        accessCode: form.contestType === "private" ? form.accessCode.trim() : null,
        challengeIds: form.challengeIds,
        challengeCount: form.challengeIds.length,
        isActive: true,
        updatedAt: serverTimestamp(),
        updatedBy: userProfile?.uid || "",
      };

      if (modal === "create") {
        await addDoc(collection(db, "contests"), {
          ...data,
          participantCount: 0,
          finalized: false,
          createdAt: serverTimestamp(),
          createdBy: userProfile?.uid || "",
        });
      } else {
        await updateDoc(doc(db, "contests", editTarget.id), data);
      }
      closeModal();
    } catch (err) {
      setError("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c) {
    await updateDoc(doc(db, "contests", c.id), { isActive: !c.isActive });
  }

  async function permanentDelete(c) {
    if (!canManage) return;
    if (!confirm(`PERMANENTLY DELETE "${c.title}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, "contests", c.id));
  }

  function getStatus(c) {
    if (c.finalized) return { label: "Finalized", cls: "ac-vis--private" };
    const now = Date.now();
    const start = c.startTime?.toMillis?.() ?? 0;
    const end = c.endTime?.toMillis?.() ?? 0;
    if (!c.isActive) return { label: "Inactive", cls: "ac-vis--draft" };
    if (now < start) return { label: "Upcoming", cls: "ac-vis--public" };
    if (now >= start && now < end) return { label: "Live", cls: "ac-diff--hard" };
    return { label: "Ended", cls: "ac-vis--draft" };
  }

  function formatDateTime(ts) {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const filtered = contests.filter(
    (c) =>
      !search ||
      c.title?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="ac-page">
      {/* Header */}
      <div className="ac-header">
        <div>
          <h1 className="ac-title">Contests</h1>
          <p className="ac-sub">{filtered.length} contests</p>
        </div>
        <div className="ac-header-actions">
          {canManage && (
            <button className="ac-create-btn" onClick={openCreate}>
              + New Contest
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <input
        className="ac-search"
        placeholder="Search contests..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {!modal && error && (
        <div className="ac-modal-error" style={{ marginBottom: 12 }}>
          ⚠ {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="ac-loading">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="ac-empty">No contests found.</div>
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Difficulty</th>
                <th>Status</th>
                <th>Start</th>
                <th>End</th>
                <th>Challenges</th>
                <th>Participants</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const status = getStatus(c);
                return (
                  <tr key={c.id} className={!c.isActive ? "ac-row--deleted" : ""}>
                    <td className="ac-col-title">
                      <span className="ac-challenge-title">{c.title}</span>
                    </td>
                    <td>
                      <span className={`ac-diff ac-diff--${c.difficulty === "mixed" ? "medium" : c.difficulty}`}>
                        {c.difficulty}
                      </span>
                    </td>
                    <td>
                      <span className={`ac-vis ${status.cls}`}>{status.label}</span>
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{formatDateTime(c.startTime)}</td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{formatDateTime(c.endTime)}</td>
                    <td>{c.challengeCount || c.challengeIds?.length || 0}</td>
                    <td>{c.participantCount || 0}</td>
                    <td className="ac-actions">
                      {canManage && (
                        <button className="ac-btn ac-btn--edit" onClick={() => openEdit(c)}>
                          Edit
                        </button>
                      )}
                      {canManage && (
                        <button
                          className={`ac-btn ${c.isActive ? "ac-btn--soft" : "ac-btn--restore"}`}
                          onClick={() => toggleActive(c)}
                        >
                          {c.isActive ? "Deactivate" : "Activate"}
                        </button>
                      )}
                      {canManage && (
                        <button className="ac-btn ac-btn--perm" onClick={() => permanentDelete(c)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modal && (
        <div className="ac-modal-overlay" onClick={closeModal}>
          <div className="ac-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ac-modal-header">
              <h2>
                {modal === "create"
                  ? "New Contest"
                  : `Edit: ${editTarget?.title}`}
              </h2>
              <button className="ac-modal-close" onClick={closeModal}>
                ✕
              </button>
            </div>

            {error && <div className="ac-modal-error">⚠ {error}</div>}

            <div className="ac-modal-body">
              {/* Title */}
              <div className="ac-field">
                <label>Title *</label>
                <input
                  className="ac-input"
                  value={form.title}
                  onChange={(e) => setField("title", e.target.value)}
                  placeholder="Contest title"
                />
              </div>

              {/* Description */}
              <div className="ac-field">
                <label>Description</label>
                <textarea
                  className="ac-textarea"
                  rows={4}
                  value={form.description}
                  onChange={(e) => setField("description", e.target.value)}
                  placeholder="Describe the contest..."
                />
              </div>

              {/* Difficulty + Max participants */}
              <div className="ac-field-row">
                <div className="ac-field">
                  <label>Difficulty</label>
                  <select
                    className="ac-select"
                    value={form.difficulty}
                    onChange={(e) => setField("difficulty", e.target.value)}
                  >
                    {DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ac-field">
                  <label>Max Participants</label>
                  <input
                    className="ac-input"
                    type="number"
                    min="1"
                    value={form.maxParticipants}
                    onChange={(e) => setField("maxParticipants", e.target.value)}
                    placeholder="Unlimited"
                  />
                </div>
                <div className="ac-field">
                  <label>Prize (optional)</label>
                  <input
                    className="ac-input"
                    value={form.prizeDescription}
                    onChange={(e) => setField("prizeDescription", e.target.value)}
                    placeholder="e.g. 500 ELO bonus"
                  />
                </div>
              </div>

              {/* Contest Type + Access Code */}
              <div className="ac-field-row">
                <div className="ac-field">
                  <label>Visibility</label>
                  <select
                    className="ac-select"
                    value={form.contestType}
                    onChange={(e) => setField("contestType", e.target.value)}
                  >
                    <option value="public">Public</option>
                    <option value="private">Private (Access Code)</option>
                  </select>
                </div>
                {form.contestType === "private" && (
                  <div className="ac-field">
                    <label>Access Code *</label>
                    <input
                      className="ac-input"
                      value={form.accessCode}
                      onChange={(e) => setField("accessCode", e.target.value)}
                      placeholder="Enter access code"
                    />
                    <span className="ac-hint">Users must enter this code to register</span>
                  </div>
                )}
              </div>

              {/* Times */}
              <div className="ac-field-row">
                <div className="ac-field">
                  <label>Start Time *</label>
                  <input
                    className="ac-input"
                    type="datetime-local"
                    value={form.startTime}
                    onChange={(e) => setField("startTime", e.target.value)}
                  />
                </div>
                <div className="ac-field">
                  <label>End Time *</label>
                  <input
                    className="ac-input"
                    type="datetime-local"
                    value={form.endTime}
                    onChange={(e) => setField("endTime", e.target.value)}
                  />
                </div>
                <div className="ac-field">
                  <label>Registration Deadline</label>
                  <input
                    className="ac-input"
                    type="datetime-local"
                    value={form.registrationDeadline}
                    onChange={(e) => setField("registrationDeadline", e.target.value)}
                  />
                  <span className="ac-hint">Defaults to start time if empty</span>
                </div>
              </div>

              {/* Challenge picker */}
              <div className="ac-field">
                <label>
                  Challenges * ({form.challengeIds.length} selected)
                </label>
                <div
                  style={{
                    maxHeight: 200,
                    overflowY: "auto",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    padding: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  {challenges.length === 0 ? (
                    <span className="ac-hint">No challenges available</span>
                  ) : (
                    challenges.map((ch) => (
                      <label
                        key={ch.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 8px",
                          borderRadius: 6,
                          cursor: "pointer",
                          background: form.challengeIds.includes(ch.id)
                            ? "rgba(0,255,136,0.08)"
                            : "transparent",
                          fontSize: 13,
                          color: "var(--color-text)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={form.challengeIds.includes(ch.id)}
                          onChange={() => toggleChallenge(ch.id)}
                          style={{ accentColor: "var(--color-accent)" }}
                        />
                        <span>{ch.title}</span>
                        <span
                          className={`ac-diff ac-diff--${ch.difficulty}`}
                          style={{ marginLeft: "auto", fontSize: 10 }}
                        >
                          {ch.difficulty}
                        </span>
                        {ch.visibility === "contest" && (
                          <span style={{ fontSize: 9, background: "rgba(255,170,0,0.15)", color: "#ffa500", padding: "1px 6px", borderRadius: 4, marginLeft: 4 }}>CONTEST</span>
                        )}
                      </label>
                    ))
                  )}
                </div>

                {/* Create new challenge button */}
                {!showChallengeForm && (
                  <button
                    type="button"
                    onClick={openNewChallenge}
                    style={{
                      marginTop: 8,
                      padding: "8px 16px",
                      background: "var(--color-accent)",
                      color: "#000",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    + Create New Challenge
                  </button>
                )}

                {/* Inline challenge creator form */}
                {showChallengeForm && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 16,
                      border: "1px solid var(--color-accent)",
                      borderRadius: 8,
                      background: "rgba(0,255,136,0.03)",
                    }}
                  >
                    <h3 style={{ margin: "0 0 12px", fontSize: 15, color: "var(--color-accent)" }}>
                      New Contest Challenge
                    </h3>
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--color-text-muted)" }}>
                      This challenge will be hidden until the contest ends, then automatically made public.
                    </p>

                    {challengeError && (
                      <div className="ac-modal-error" style={{ marginBottom: 8 }}>⚠ {challengeError}</div>
                    )}

                    {/* Title */}
                    <div className="ac-field">
                      <label>Title *</label>
                      <input className="ac-input" value={challengeForm.title}
                        onChange={(e) => setCField("title", e.target.value)}
                        placeholder="Challenge title" />
                    </div>

                    {/* Description */}
                    <div className="ac-field">
                      <label>Description * (Markdown supported)</label>
                      <textarea className="ac-textarea" rows={4}
                        value={challengeForm.description}
                        onChange={(e) => setCField("description", e.target.value)}
                        placeholder="Describe the challenge..." />
                    </div>

                    {/* Type + Difficulty + Category + Points */}
                    <div className="ac-field-row">
                      <div className="ac-field">
                        <label>Type</label>
                        <select className="ac-select" value={challengeForm.type}
                          onChange={(e) => setCField("type", e.target.value)}>
                          {CHALLENGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="ac-field">
                        <label>Difficulty</label>
                        <select className="ac-select" value={challengeForm.difficulty}
                          onChange={(e) => setCField("difficulty", e.target.value)}>
                          {CHALLENGE_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div className="ac-field">
                        <label>Category</label>
                        <select className="ac-select" value={challengeForm.category}
                          onChange={(e) => setCField("category", e.target.value)}>
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="ac-field">
                        <label>Points</label>
                        <input className="ac-input" type="number" min="1"
                          value={challengeForm.basePoints}
                          onChange={(e) => setCField("basePoints", e.target.value)} />
                      </div>
                    </div>

                    {/* Flag */}
                    <div className="ac-field">
                      <label>Flag *</label>
                      <input className="ac-input ac-input--flag" type="text"
                        value={challengeForm.flag}
                        onChange={(e) => setCField("flag", e.target.value)}
                        placeholder="flag{secret_answer}" />
                    </div>

                    {/* Flag format hint */}
                    <div className="ac-field">
                      <label>Flag Format (hint for users)</label>
                      <input className="ac-input" type="text"
                        value={challengeForm.flagFormat}
                        onChange={(e) => setCField("flagFormat", e.target.value)}
                        placeholder="e.g. FLAG{****** *****}" />
                    </div>

                    {/* Tags */}
                    <div className="ac-field">
                      <label>Tags (comma-separated)</label>
                      <input className="ac-input" value={challengeForm.tags}
                        onChange={(e) => setCField("tags", e.target.value)}
                        placeholder="osint, recon, geolocation" />
                    </div>

                    {/* Hints */}
                    <div className="ac-field">
                      <label>Hints</label>
                      {challengeForm.hints.map((h, i) => (
                        <div key={i} className="ac-hint-row">
                          <input className="ac-input" value={h}
                            onChange={(e) => setCHint(i, e.target.value)}
                            placeholder={`Hint ${i + 1}`} />
                          <button type="button" className="ac-hint-remove"
                            onClick={() => removeCHint(i)}>✕</button>
                        </div>
                      ))}
                      <button type="button" className="ac-hint-add" onClick={addCHint}>+ Add hint</button>
                    </div>

                    {/* Time limit */}
                    <div className="ac-field">
                      <label>Time Limit (mins, optional)</label>
                      <input className="ac-input" type="number" min="1"
                        value={challengeForm.timeLimit}
                        onChange={(e) => setCField("timeLimit", e.target.value)}
                        placeholder="No limit" />
                    </div>

                    {/* Media */}
                    <div className="ac-field-row">
                      <div className="ac-field">
                        <label>Media Type</label>
                        <select className="ac-select" value={challengeForm.mediaType}
                          onChange={(e) => setCField("mediaType", e.target.value)}>
                          {MEDIA_TYPES.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      {challengeForm.mediaType !== "none" && (
                        <div className="ac-field" style={{ flex: 2 }}>
                          <label>Upload Media</label>
                          <input ref={fileRef} type="file" className="ac-file-input"
                            accept={
                              challengeForm.mediaType === "image" ? "image/*" :
                              challengeForm.mediaType === "video" ? "video/*" :
                              challengeForm.mediaType === "audio" ? "audio/*" : "*/*"
                            } />
                          {uploadProgress > 0 && uploadProgress < 100 && (
                            <div className="ac-upload-progress">
                              <div className="ac-upload-bar" style={{ width: `${uploadProgress}%` }} />
                              <span>{uploadProgress}%</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button
                        type="button"
                        className="ac-btn ac-btn--cancel"
                        onClick={() => setShowChallengeForm(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="ac-btn ac-btn--save"
                        onClick={handleSaveChallenge}
                        disabled={savingChallenge}
                      >
                        {savingChallenge ? "Creating..." : "Create Challenge"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="ac-modal-footer">
              <button className="ac-btn ac-btn--cancel" onClick={closeModal}>
                Cancel
              </button>
              <button
                className="ac-btn ac-btn--save"
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : modal === "create"
                  ? "Create Contest"
                  : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}