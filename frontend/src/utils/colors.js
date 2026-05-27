/**
 * Determines whether black or white text should be used on a given background color
 * for optimal contrast.
 * @param {string} hex - The background hex color (e.g., "#ffffff" or "ffffff")
 * @returns {string} - "black" or "white"
 */
export function getContrastColor(hex) {
  if (!hex) return '#000000';
  
  // Remove hash if present
  const color = hex.replace('#', '');
  
  // Convert to RGB
  const r = parseInt(color.substr(0, 2), 16);
  const g = parseInt(color.substr(2, 2), 16);
  const b = parseInt(color.substr(4, 2), 16);
  
  // Calculate brightness using the YIQ formula
  // (Standard formula: 0.299*R + 0.587*G + 0.114*B)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  return brightness > 128 ? '#000000' : '#ffffff';
}
