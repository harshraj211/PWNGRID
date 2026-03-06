/**
 * cloudinary.js
 * Shared Cloudinary upload utility — replaces Firebase Storage everywhere.
 * Uses unsigned upload preset (no backend needed).
 *
 * Setup:
 *  1. Create a free Cloudinary account at cloudinary.com
 *  2. Go to Settings → Upload → Add upload preset → set to "Unsigned"
 *  3. Add to your .env:
 *     VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
 *     VITE_CLOUDINARY_UPLOAD_PRESET=your_preset_name
 *
 * File location: frontend/src/lib/cloudinary.js
 */

const CLOUD_NAME    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

/**
 * Upload a file to Cloudinary.
 * @param {File} file - The file to upload
 * @param {object} options
 * @param {string} options.folder - Cloudinary folder (e.g. "avatars", "challenges")
 * @param {function} options.onProgress - (percent: number) => void
 * @returns {Promise<{ url: string, publicId: string }>}
 */
export async function uploadToCloudinary(file, { folder = "uploads", onProgress } = {}) {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error("Cloudinary not configured. Add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to .env");
  }

  const formData = new FormData();
  formData.append("file",           file);
  formData.append("upload_preset",  UPLOAD_PRESET);
  formData.append("folder",         folder);
  formData.append("access_mode",    "public");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        resolve({
          url:      data.secure_url,
          publicId: data.public_id,
        });
      } else {
        reject(new Error(`Cloudinary upload failed: ${xhr.status} ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Cloudinary upload network error"));

    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`);
    xhr.send(formData);
  });
}

/**
 * Delete a file from Cloudinary.
 * Note: Deletion from frontend requires a signed request (backend).
 * For now we just log — files can be cleaned up from Cloudinary dashboard.
 */
export function deleteFromCloudinary(publicId) {
  console.log("Cloudinary delete (manual cleanup needed):", publicId);
}