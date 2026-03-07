/**
 * WriteupEditor.jsx
 * Rich writeup editor shown after solving a challenge.
 * Supports text sections + inline image uploads (drag & drop or click to insert).
 * Stores: writeups/{challengeId}_{userId} in Firestore
 *         writeup images in Storage: writeups/{userId}/{challengeId}/
 *
 * File location: frontend/src/components/writeup/WriteupEditor.jsx
 */
import { useState, useRef, useEffect } from "react";
import { doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase/config";
import { uploadToCloudinary } from "../../lib/cloudinary";
import { useAuth } from "../../context/AuthContext";
import "./WriteupEditor.css";

export default function WriteupEditor({ challengeId, challengeTitle, onClose }) {
  const { currentUser } = useAuth();
  const [blocks,   setBlocks]   = useState([{ type: "text", content: "" }]);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [loading,  setLoading]  = useState(true);
  const fileInputRef = useRef(null);
  const insertAfterRef = useRef(null); // index to insert image after

  const docId = `${challengeId}_${currentUser.uid}`;

  useEffect(() => { loadExisting(); }, []);

  async function loadExisting() {
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "writeups", docId));
      if (snap.exists()) {
        const d = snap.data();
        setBlocks(d.blocks || [{ type: "text", content: "" }]);
        setIsPublic(d.isPublic !== false);
      }
    } catch { /* ignore non-critical errors */ }
    setLoading(false);
  }

  // ── Block operations ───────────────────────────────────────────────────────
  function updateText(idx, val) {
    setBlocks(b => b.map((bl, i) => i === idx ? { ...bl, content: val } : bl));
  }

  function addTextAfter(idx) {
    setBlocks(b => [...b.slice(0, idx + 1), { type: "text", content: "" }, ...b.slice(idx + 1)]);
  }

  function removeBlock(idx) {
    setBlocks(b => b.length <= 1 ? b : b.filter((_, i) => i !== idx));
  }

  function triggerImageInsert(idx) {
    insertAfterRef.current = idx;
    fileInputRef.current.click();
  }

  async function handleImageFiles(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const insertAfter = insertAfterRef.current ?? blocks.length - 1;
    const placeholders = files.map((_, i) => ({
      type: "image", url: null, uploading: true, caption: "", _key: Date.now() + i
    }));
    setBlocks(b => [
      ...b.slice(0, insertAfter + 1),
      ...placeholders,
      ...b.slice(insertAfter + 1)
    ]);
    // Upload all in parallel
    const uploaded = await Promise.all(files.map(file => uploadImage(file)));
    setBlocks(b => {
      let pi = 0;
      return b.map(bl => {
        if (bl.uploading && pi < uploaded.length) {
          return { type: "image", url: uploaded[pi++], uploading: false, caption: "" };
        }
        return bl;
      });
    });
    e.target.value = "";
  }

  async function uploadImage(file) {
    const { url } = await uploadToCloudinary(file, {
      folder: `osint-arena/writeups/${currentUser.uid}`,
    });
    return url;
  }

  function updateCaption(idx, val) {
    setBlocks(b => b.map((bl, i) => i === idx ? { ...bl, caption: val } : bl));
  }

  // ── Drag & drop on text areas ──────────────────────────────────────────────
  function handleDrop(e, idx) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    insertAfterRef.current = idx;
    // Create a fake event
    const dt = { target: { files }, preventDefault: () => {} };
    handleImageFiles(dt);
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      await setDoc(doc(db, "writeups", docId), {
        challengeId,
        userId:    currentUser.uid,
        blocks:    blocks.filter(b => !b.uploading),
        isPublic,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  if (loading) return (
    <div className="writeup-editor writeup-editor--loading">
      <div className="writeup-spinner" />
    </div>
  );

  return (
    <div className="writeup-editor">
      <div className="writeup-header">
        <div className="writeup-header-left">
          <span className="writeup-icon">📝</span>
          <div>
            <div className="writeup-title">Write-up</div>
            <div className="writeup-subtitle">{challengeTitle}</div>
          </div>
        </div>
        <div className="writeup-header-right">
          <label className="writeup-visibility">
            <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} />
            <span>Public</span>
          </label>
          <button className="writeup-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : saved ? "✓ Saved!" : "Save write-up"}
          </button>
          {onClose && (
            <button className="writeup-close-btn" onClick={onClose}>✕</button>
          )}
        </div>
      </div>

      <div className="writeup-tip">
        💡 Document your methodology — drag & drop images anywhere, or use the image button between blocks.
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={handleImageFiles}
      />

      <div className="writeup-blocks">
        {blocks.map((block, idx) => (
          <div key={block._key || idx} className="writeup-block-wrap">
            {block.type === "text" ? (
              <div className="writeup-text-block"
                onDragOver={e => e.preventDefault()}
                onDrop={e => handleDrop(e, idx)}>
                <textarea
                  className="writeup-textarea"
                  placeholder={idx === 0
                    ? "Document your approach here...\n\nWhat tools did you use? What was your thought process? Drag & drop images directly here."
                    : "Continue writing..."}
                  value={block.content}
                  onChange={e => updateText(idx, e.target.value)}
                  rows={6}
                />
                {blocks.length > 1 && (
                  <button className="writeup-remove-btn" onClick={() => removeBlock(idx)} title="Remove block">✕</button>
                )}
              </div>
            ) : (
              <div className="writeup-image-block">
                {block.uploading ? (
                  <div className="writeup-img-uploading">
                    <div className="writeup-spinner" />
                    <span>Uploading...</span>
                  </div>
                ) : (
                  <>
                    <img src={block.url} alt={block.caption || "writeup image"} className="writeup-img" />
                    <input
                      className="writeup-caption"
                      placeholder="Add caption (optional)"
                      value={block.caption || ""}
                      onChange={e => updateCaption(idx, e.target.value)}
                    />
                  </>
                )}
                <button className="writeup-remove-btn" onClick={() => removeBlock(idx)} title="Remove image">✕</button>
              </div>
            )}

            {/* Insert buttons between blocks */}
            <div className="writeup-insert-row">
              <button className="writeup-insert-btn" onClick={() => addTextAfter(idx)} title="Add text block">
                + Text
              </button>
              <button className="writeup-insert-btn writeup-insert-btn--img" onClick={() => triggerImageInsert(idx)} title="Insert image">
                + Image
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}