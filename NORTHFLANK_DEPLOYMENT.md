# Deploying ExamPool to Northflank

ExamPool uses Docker to build its Bun & Next.js environment seamlessly, making it very easy to deploy on [Northflank](https://northflank.com/).

> [!NOTE]
> ExamPool uses a SQLite database to store students, questions, and results. When deploying on any cloud platform, it is critical to use a **Persistent Volume** so that your data is saved permanently across restarts and deployments. Northflank supports persistent volumes on their paid plans.

## Manual Deployment

To deploy ExamPool on Northflank through the dashboard:

1. Go to your [Northflank Dashboard](https://app.northflank.com/).
2. Create a new **Service** and select **Combined** (builds and runs your code).
3. Under **Repository**, select your GitHub repository where ExamPool is hosted.
4. Under **Build Options**, Northflank will automatically detect the `Dockerfile`. Ensure **Docker** is selected.
5. Under **Resources**, choose an appropriate plan (must support persistent volumes).
6. Scroll down to **Volumes**:
   - Click **Add Volume**.
   - Container Mount Path: `/app/data`
   - Size: 1024 MB (1 GB) or more as needed.
7. Scroll down to **Environment Variables** and add the following:
   - `EXAMPOOL_DB` = `/app/data/exampool.db`
   - `PORT` = `8000`
   - `NODE_ENV` = `production`
8. Under **Ports**, ensure port `8000` is exposed (HTTP).
9. Click **Create Service**.

Northflank will now build the Docker image and deploy your ExamPool instance with a persistent SQLite database.
