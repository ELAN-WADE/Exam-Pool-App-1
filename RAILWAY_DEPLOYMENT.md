# Deploying ExamPool to Railway

ExamPool is fully optimized to be deployed on [Railway.app](https://railway.app/). Railway uses Nixpacks to automatically detect the Bun environment and build the application.

## 1. Connect GitHub to Railway
1. Create a new project on Railway.
2. Select **"Deploy from GitHub repo"** and choose your ExamPool repository.
3. Railway will automatically detect the Bun environment and begin building.

## 2. Configure Environment Variables
Go to your Railway Project -> Variables and add the following:
- `NODE_ENV`: `production`

*(Note: Railway automatically provides a `PORT` variable which `server.ts` will pick up).*

## 3. Configure a Persistent Database Volume (CRITICAL)
By default, Railway uses ephemeral filesystems, meaning your database will be wiped every time you push new code or the container restarts. You **must** attach a volume to persist your SQLite database.

1. Go to your Railway service settings.
2. Under **Volumes**, click **New Volume**.
3. Set the **Mount Path** to `/app/data` (this is where the volume will be attached inside the container).
4. Go to the **Variables** tab and add:
   - `EXAMPOOL_DB`: `/app/data/exampool.db`

This tells the server to save the SQLite database file inside the persistent volume.

## 4. That's it!
Once the volume is attached and variables are set, Railway will automatically redeploy the service. 
- The `postinstall` script handles installing frontend dependencies.
- The `build` script automatically compiles the Next.js frontend into static files.
- The `start` script runs the Bun server which serves both the API and the compiled frontend.
