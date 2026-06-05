// Deterministic string hash (h*31 + charCode, 32-bit). Used for stable
// color/avatar assignment from a seed. Previously duplicated identically in
// design/index.jsx (hashStr) and components/UserAvatar.jsx (hashString).
export function hashStr(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
