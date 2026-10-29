# Nebula File Host — Local Edition

This is the local, npm-startable edition of the Nebula file host. It keeps the original site's dark neon design and includes registration/login, file uploads and share links, user roles, admin controls, and an Owner Profile page.

## Run locally

1. Install **Node.js 18 or newer**.
2. Open a terminal in this folder.
3. Run:

   ```bash
   npm install
   npm start
   ```

4. Visit **http://localhost:3000**.

`npm run start` works too; it runs the same `start` script.

## Owner account

On the first start, the server creates the local owner/admin account if one does not already exist:

- Username: `admin`
- Temporary password: `ChangeMe123!`

Log in and open **Owner Profile** to set your display name, bio, and a new password. Change the temporary password before using the site for anything beyond local testing.

## Local data

The server creates `data/db.json` and `data/files/` automatically. Accounts, profile settings, file metadata, and uploaded files stay in that folder. Back it up to preserve your local data. Delete `data/db.json` only if you intentionally want to reset accounts; uploaded files are stored separately in `data/files/`.

## Configuration

- `public/config.js` — site name, theme, navigation and feature toggles.
- `public/style.css` — visual styling.
- `server.config.json` — roles, upload limits, registration and blocked extensions.
- `user.json` — role overrides. These overrides take priority over roles saved to the local database.

## Notes

This version replaces Netlify Blobs/Functions with a local Express server and local disk storage. It is intended for localhost development, not as a public production deployment. Set a strong `JWT_SECRET` and add appropriate security controls before deploying it publicly.
