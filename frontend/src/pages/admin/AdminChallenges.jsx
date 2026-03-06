/**
 * AdminChallenges.jsx
 * Full CRUD for challenges — accessible to admin + moderator.
 * Permanent delete: admin only.
 *
 * File location: frontend/src/pages/admin/AdminChallenges.jsx
 */
import { useState, useEffect, useRef } from "react";
import {
  collection, query, onSnapshot,
  doc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, where,
} from "firebase/firestore";
import { db } from "../../firebase/config";
import { uploadToCloudinary } from "../../lib/cloudinary";
import { useAuth } from "../../context/AuthContext";
import { hashAnswer } from "../../lib/hashAnswer";
import "./AdminChallenges.css";

const DIFFICULTIES  = ["easy", "medium", "hard"];
const CHALLENGE_TYPES = ["standard", "investigation"];
const CATEGORIES    = ["search","domain-recon","image-osint","metadata","network-osint",
                        "social-media","web-archive","geolocation","code-recon",
                        "dark-web","tools","people-search","data-breach","other"];
const VISIBILITIES  = ["public", "draft", "private"];
const MEDIA_TYPES   = ["none","image","video","audio","file"];

const EMPTY_FORM = {
  title: "", description: "", type: "standard", difficulty: "easy", category: "search",
  basePoints: 100, tags: "", visibility: "draft", flag: "", flagFormat: "", hints: [""],
  timeLimit: "", mediaType: "none", mediaURL: "",
};

export default function AdminChallenges() {
  const { isAdmin, isMod, userProfile } = useAuth();
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showDeleted, setShowDeleted] = useState(false);
  const [modal, setModal]           = useState(null); // null | "create" | "edit"
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState("");
  const [search, setSearch]         = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileRef = useRef();

  // Real-time challenges listener
  useEffect(() => {
    setLoading(true);
    const q = showDeleted
      ? query(collection(db, "challenges"), where("isDeleted", "==", true))
      : query(collection(db, "challenges"), where("isDeleted", "==", false));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => {
          const aMs = a.createdAt?.toMillis?.() || 0;
          const bMs = b.createdAt?.toMillis?.() || 0;
          return bMs - aMs;
        });
        setChallenges(items);
        setLoading(false);
      },
      (err) => {
        setError(`Load failed: ${err.message}`);
        setLoading(false);
      }
    );
    return unsub;
  }, [showDeleted]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setError("");
    setModal("create");
  }

  function openEdit(ch) {
    setForm({
      title:       ch.title       || "",
      description: ch.description || "",
      type:        ch.type        || "standard",
      difficulty:  ch.difficulty  || "easy",
      category:    ch.category    || "search",
      basePoints:  ch.basePoints  || 100,
      tags:        (ch.tags || []).join(", "),
      visibility:  ch.visibility  || "draft",
      flag:        ch.rawFlag     || "",  // Show saved flag to admin
      flagFormat:  ch.flagFormat   || "",
      hints:       ch.hints?.length ? ch.hints : [""],
      timeLimit:   ch.timeLimit   || "",
      mediaType:   ch.mediaType   || "none",
      mediaURL:    ch.mediaURL    || "",
      mediaFilename: ch.mediaFilename || "",
    });
    setEditTarget(ch);
    setError("");
    setModal("edit");
  }

  function closeModal() { setModal(null); setEditTarget(null); setUploadProgress(0); }

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function setHint(i, v) {
    setForm(f => { const h = [...f.hints]; h[i] = v; return { ...f, hints: h }; });
  }
  function addHint()    { setForm(f => ({ ...f, hints: [...f.hints, ""] })); }
  function removeHint(i){ setForm(f => ({ ...f, hints: f.hints.filter((_, j) => j !== i) })); }

  async function handleMediaUpload(file) {
    if (!file) return { url: "", filename: "" };
    const { url } = await uploadToCloudinary(file, {
      folder: "osint-arena/challenges",
      onProgress: setUploadProgress,
    });
    return { url, filename: file.name };
  }

  async function handleSave() {
    setError("");
    if (!form.title.trim())       { setError("Title is required."); return; }
    if (!form.description.trim()) { setError("Description is required."); return; }
    if (!form.flag.trim() && modal === "create") { setError("Flag is required."); return; }

    setSaving(true);
    try {
      // Upload media if file selected
      let mediaURL = form.mediaURL;
      let mediaFilename = form.mediaFilename || null;
      if (fileRef.current?.files[0]) {
        const uploadResult = await handleMediaUpload(fileRef.current.files[0]);
        mediaURL = uploadResult.url;
        mediaFilename = uploadResult.filename;
      }

      const tags = form.tags.split(",").map(t => t.trim()).filter(Boolean);
      const hints = form.hints.filter(h => h.trim());

      const data = {
        title:       form.title.trim(),
        description: form.description.trim(),
        type:        form.type,
        difficulty:  form.difficulty,
        category:    form.category,
        basePoints:  Number(form.basePoints) || 100,
        tags,
        visibility:  form.visibility,
        hints,
        timeLimit:   form.timeLimit ? Number(form.timeLimit) : null,
        mediaType:   form.mediaType,
        mediaURL:    mediaURL || null,
        mediaFilename: mediaFilename,
        flagFormat:  form.flagFormat.trim() || null,
        isActive:    form.visibility === "public",
        freeForAll:  form.difficulty === "easy",
        isFreeThisWeek: false,
        updatedAt:   serverTimestamp(),
        updatedBy:   userProfile?.uid || "",
      };

      if (form.flag.trim()) {
        data.answerHash = await hashAnswer(form.flag.trim().toLowerCase());
        data.rawFlag = form.flag.trim();  // Store raw flag so admin can view/edit later
      }

      if (modal === "create") {
        const slug = form.title.trim().toLowerCase()
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        await addDoc(collection(db, "challenges"), {
          ...data,
          slug,
          isDeleted:    false,
          solveCount:   0,
          attemptCount: 0,
          createdAt:    serverTimestamp(),
          createdBy:    userProfile?.uid || "",
        });
      } else {
        await updateDoc(doc(db, "challenges", editTarget.id), data);
      }
      closeModal();
    } catch (err) {
      setError("Save failed: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function softDelete(ch) {
    if (!confirm(`Soft delete "${ch.title}"? It can be restored.`)) return;
    await updateDoc(doc(db, "challenges", ch.id), { isDeleted: true, deletedAt: serverTimestamp() });
  }

  async function restore(ch) {
    await updateDoc(doc(db, "challenges", ch.id), { isDeleted: false, deletedAt: null });
  }

  async function permanentDelete(ch) {
    if (!isAdmin) return;
    if (!confirm(`PERMANENTLY DELETE "${ch.title}"? This cannot be undone.`)) return;
    // Cloudinary deletion requires backend — files cleaned up from dashboard
    await deleteDoc(doc(db, "challenges", ch.id));
  }

  const filtered = challenges.filter(c =>
    !search || c.title?.toLowerCase().includes(search.toLowerCase()) ||
    c.category?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="ac-page">
      {/* Header */}
      <div className="ac-header">
        <div>
          <h1 className="ac-title">Challenges</h1>
          <p className="ac-sub">{filtered.length} {showDeleted ? "deleted" : "active"} challenges</p>
        </div>
        <div className="ac-header-actions">
          <button className={`ac-toggle-btn ${showDeleted ? "ac-toggle-btn--active" : ""}`}
            onClick={() => setShowDeleted(d => !d)}>
            {showDeleted ? "Show Active" : "Show Deleted"}
          </button>
          {isMod && (
            <button className="ac-create-btn" onClick={openCreate}>+ New Challenge</button>
          )}
        </div>
      </div>

      {/* Search */}
      <input className="ac-search" placeholder="Search challenges..."
        value={search} onChange={e => setSearch(e.target.value)} />

      {!modal && error && (
        <div className="ac-modal-error" style={{ marginBottom: 12 }}>⚠ {error}</div>
      )}

      {/* Table */}
      {loading ? (
        <div className="ac-loading">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="ac-empty">No challenges found.</div>
      ) : (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Difficulty</th>
                <th>Category</th>
                <th>Points</th>
                <th>Visibility</th>
                <th>Solves</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ch => (
                <tr key={ch.id} className={ch.isDeleted ? "ac-row--deleted" : ""}>
                  <td className="ac-col-title">
                    <span className="ac-challenge-title">{ch.title}</span>
                    {ch.mediaType && ch.mediaType !== "none" && (
                      <span className="ac-media-chip">{ch.mediaType}</span>
                    )}
                  </td>
                  <td><span className={`ac-diff ac-diff--${ch.difficulty}`}>{ch.difficulty}</span></td>
                  <td>{ch.category}</td>
                  <td>{ch.basePoints}</td>
                  <td><span className={`ac-vis ac-vis--${ch.visibility}`}>{ch.visibility}</span></td>
                  <td>{ch.solveCount || 0}</td>
                  <td className="ac-actions">
                    {!showDeleted ? (
                      <>
                        {isMod && (
                          <button className="ac-btn ac-btn--edit" onClick={() => openEdit(ch)}>Edit</button>
                        )}
                        {isMod && (
                          <button className="ac-btn ac-btn--soft" onClick={() => softDelete(ch)}>Delete</button>
                        )}
                      </>
                    ) : (
                      <>
                        <button className="ac-btn ac-btn--restore" onClick={() => restore(ch)}>Restore</button>
                        {isAdmin && (
                          <button className="ac-btn ac-btn--perm" onClick={() => permanentDelete(ch)}>
                            Destroy
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modal && (
        <div className="ac-modal-overlay" onClick={closeModal}>
          <div className="ac-modal" onClick={e => e.stopPropagation()}>
            <div className="ac-modal-header">
              <h2>{modal === "create" ? "New Challenge" : `Edit: ${editTarget?.title}`}</h2>
              <button className="ac-modal-close" onClick={closeModal}>✕</button>
            </div>

            {error && <div className="ac-modal-error">⚠ {error}</div>}

            <div className="ac-modal-body">
              {/* Title */}
              <div className="ac-field">
                <label>Title *</label>
                <input className="ac-input" value={form.title}
                  onChange={e => setField("title", e.target.value)} placeholder="Challenge title" />
              </div>

              {/* Description */}
              <div className="ac-field">
                <label>Description * (Markdown supported)</label>
                <textarea className="ac-textarea" rows={6} value={form.description}
                  onChange={e => setField("description", e.target.value)}
                  placeholder="## Challenge\n\nDescribe the task..." />
              </div>

              {/* Row: difficulty + category + points */}
              <div className="ac-field-row">
                <div className="ac-field">
                  <label>Challenge Type</label>
                  <select className="ac-select" value={form.type}
                    onChange={e => setField("type", e.target.value)}>
                    {CHALLENGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="ac-field">
                  <label>Difficulty</label>
                  <select className="ac-select" value={form.difficulty}
                    onChange={e => setField("difficulty", e.target.value)}>
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="ac-field">
                  <label>Category</label>
                  <select className="ac-select" value={form.category}
                    onChange={e => setField("category", e.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="ac-field">
                  <label>Points</label>
                  <input className="ac-input" type="number" min="1" value={form.basePoints}
                    onChange={e => setField("basePoints", e.target.value)} />
                </div>
              </div>

              {/* Row: visibility + time limit */}
              <div className="ac-field-row">
                <div className="ac-field">
                  <label>Visibility</label>
                  <select className="ac-select" value={form.visibility}
                    onChange={e => setField("visibility", e.target.value)}>
                    {VISIBILITIES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div className="ac-field">
                  <label>Time Limit (mins, optional)</label>
                  <input className="ac-input" type="number" min="1"
                    value={form.timeLimit} onChange={e => setField("timeLimit", e.target.value)}
                    placeholder="No limit" />
                </div>
              </div>

              {/* Tags */}
              <div className="ac-field">
                <label>Tags (comma-separated)</label>
                <input className="ac-input" value={form.tags}
                  onChange={e => setField("tags", e.target.value)}
                  placeholder="osint, google, recon" />
              </div>

              {/* Flag */}
              <div className="ac-field">
                <label>Flag {modal === "edit" ? "(edit to change, or leave as-is to keep)" : "*"}</label>
                <input className="ac-input ac-input--flag" type="text"
                  value={form.flag} onChange={e => setField("flag", e.target.value)}
                  placeholder={modal === "edit" ? "Enter new flag to update" : "flag{secret_answer}"} />
                <span className="ac-hint">Stored as SHA-256 hash alongside raw value (admin-only visibility)</span>
              </div>

              {/* Flag Format Hint */}
              <div className="ac-field">
                <label>Flag Format (shown to users as a hint)</label>
                <input className="ac-input" type="text"
                  value={form.flagFormat} onChange={e => setField("flagFormat", e.target.value)}
                  placeholder="e.g. FLAG{****** *****}" />
                <span className="ac-hint">Helps users know the expected format. Leave empty to hide.</span>
              </div>

              {/* Hints */}
              <div className="ac-field">
                <label>Hints</label>
                {form.hints.map((h, i) => (
                  <div key={i} className="ac-hint-row">
                    <input className="ac-input" value={h}
                      onChange={e => setHint(i, e.target.value)}
                      placeholder={`Hint ${i + 1}`} />
                    <button type="button" className="ac-hint-remove"
                      onClick={() => removeHint(i)}>✕</button>
                  </div>
                ))}
                <button type="button" className="ac-hint-add" onClick={addHint}>+ Add hint</button>
              </div>

              {/* Media */}
              <div className="ac-field">
                <label>Media Type</label>
                <select className="ac-select" value={form.mediaType}
                  onChange={e => setField("mediaType", e.target.value)}>
                  {MEDIA_TYPES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              {form.mediaType !== "none" && (
                <div className="ac-field">
                  <label>{form.mediaURL ? "Replace Media" : "Upload Media"}</label>
                  <input ref={fileRef} type="file" className="ac-file-input"
                    accept={
                      form.mediaType === "image" ? "image/*" :
                      form.mediaType === "video" ? "video/*" :
                      form.mediaType === "audio" ? "audio/*" : "*/*"
                    }
                  />
                  {uploadProgress > 0 && uploadProgress < 100 && (
                    <div className="ac-upload-progress">
                      <div className="ac-upload-bar" style={{ width: `${uploadProgress}%` }} />
                      <span>{uploadProgress}%</span>
                    </div>
                  )}

                  {/* Current media preview */}
                  {form.mediaURL && (
                    <div className="ac-media-preview">
                      <div className="ac-media-preview-header">
                        <span className="ac-hint">Current media:</span>
                        <a href={form.mediaURL} target="_blank" rel="noopener noreferrer"
                          className="ac-media-preview-link">Open in new tab ↗</a>
                      </div>
                      {form.mediaType === "image" && (
                        <img src={form.mediaURL} alt="Current challenge media"
                          className="ac-media-preview-img"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      )}
                      {form.mediaType === "video" && (
                        <video controls className="ac-media-preview-video" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 6 }}>
                          <source src={form.mediaURL} />
                        </video>
                      )}
                      {form.mediaType === "audio" && (
                        <audio controls style={{ width: '100%', marginTop: 4 }}>
                          <source src={form.mediaURL} />
                        </audio>
                      )}
                      {form.mediaFilename && (
                        <span className="ac-hint" style={{ marginTop: 4 }}>Filename: {form.mediaFilename}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="ac-modal-footer">
              <button className="ac-btn ac-btn--cancel" onClick={closeModal}>Cancel</button>
              <button className="ac-btn ac-btn--save" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : modal === "create" ? "Create Challenge" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}