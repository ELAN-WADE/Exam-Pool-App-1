# Deploying ExamPool to Render.com

ExamPool uses Docker to build its Bun & Next.js environment seamlessly, making it very easy to deploy on [Render](https://render.com/).

> [!WARNING]
> **Important limitation regarding Render's Free Plan:**
> Render's Free tier **does not support persistent Disks**. Because ExamPool uses a SQLite database to store students, questions, and results, deploying on Render's free tier means **your database will be wiped every time the app goes to sleep** (which happens after 15 minutes of inactivity). 
> 
> To deploy ExamPool on Render so that your data is saved permanently, you **must** use at least the **Starter Plan** (~$7/month) to enable persistent Disks. *(If you want a free persistent option, Fly.io is highly recommended instead!)*

## Easy Deployment (Blueprint)
The easiest way to deploy ExamPool to Render is by using the **Blueprint** feature. I have already included a `render.yaml` configuration file in this repository.

1. Go to your [Render Dashboard](https://dashboard.render.com/).
2. Click the **"New +"** button at the top and select **"Blueprint"**.
3. Connect your GitHub account and select your ExamPool repository.
4. Render will automatically read the `render.yaml` file.
5. It will set up the Web Service, configure the Docker environment, set the open Ports, and create the persistent Disk (`exampool_data`) all automatically!
6. Click **Apply**.

Render will now build the Dockerfile and launch your app. 

## Manual Deployment
If you prefer to configure it manually through the dashboard instead of using the Blueprint:
1. Click **New +** -> **Web Service**.
2. Select **Build and deploy from a Git repository** and choose your repo.
3. **Environment:** Docker
4. **Instance Type:** Starter (required for Disks)
5. Scroll down to **Advanced** -> **Disks**.
   - Click **Add Disk**.
   - Name: `exampool_data`
   - Mount Path: `/app/data`
   - Size: 1 GB
6. Scroll to **Environment Variables** and add:
   - `EXAMPOOL_DB` = `/app/data/exampool.db`
   - `PORT` = `8000`
   - `NODE_ENV` = `production`
7. Click **Create Web Service**.
