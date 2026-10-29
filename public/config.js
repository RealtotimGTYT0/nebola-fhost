// =====================================================
//  SITE CUSTOMISATION — edit anything here, no build needed
//  (Server rules like roles/limits live in /server.config.json,
//   user roles in /user.json)
// =====================================================
window.SITE = {
  name: "Nebula",
  tagline: "Drop a file. Get a link. Done.",
  logoEmoji: "☄️",           // or set logoUrl
  logoUrl: "",
  footer: "© Nebula File Host",

  theme: {
    bg: "#07070c",
    surface: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.09)",
    text: "#ecebf5",
    muted: "#8b8aa0",
    accent: "#00e5a8",
    accent2: "#00a3ff",
    danger: "#ff4d6d",
    radius: "16px",
    font: "'Space Grotesk', system-ui, sans-serif",
    fontUrl: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap",
    backgroundGlow: true,     // animated gradient blobs
    grid: true                // subtle grid background
  },

  features: {
    showLandingStats: true,
    copyLinkOnUpload: true,
    showImagePreviews: true
  },

  // Colour per role badge (any role name from server.config.json)
  roleColors: {
    user: "#8b8aa0",
    vip: "#ffc857",
    moderator: "#00a3ff",
    admin: "#ff4d6d"
  },

  nav: [
    { label: "Home", href: "/" },
    { label: "Dashboard", href: "/dashboard.html", auth: true },
    { label: "Admin", href: "/admin.html", admin: true }
  ]
};
