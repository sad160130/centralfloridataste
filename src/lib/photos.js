// Build-time lookup into the Places-photo ledger written by
// scripts/fetch-restaurant-photos.mjs. Returns the local image src + Google's
// required attribution when a photo exists, else null (templates fall back to
// the grade-tinted monogram tile).
import cache from '../../Data/photo_cache.json';

export function photoInfo(licenseKey) {
  const e = cache[String(licenseKey)];
  if (e && e.status === 'ok' && e.blob_url) {
    return {
      src: e.blob_url, // served from Vercel Blob (blob.vercel-storage.com)
      attribution: Array.isArray(e.attribution) ? e.attribution : [],
    };
  }
  return null;
}
