# Deploying ExamPool to Fly.io

I have prepared the codebase with a custom `Dockerfile` and a `fly.toml` configuration to make deploying to [Fly.io](https://fly.io/) as seamless as possible. Fly.io is perfect for this app because it supports persistent SQLite volumes natively!

## Prerequisites
1. Sign up for an account at [fly.io](https://fly.io/).
2. Install the `flyctl` command-line tool on your computer. You can find the installation instructions here: [Install flyctl](https://fly.io/docs/hands-on/install-flyctl/).
3. Open your terminal and log in by running:
   ```bash
   fly auth login
   ```

## Step-by-Step Deployment

**1. Open your terminal in the ExamPool project folder:**
Make sure you are in the root directory (where `fly.toml` is located).

**2. Create a new Fly app:**
Run the launch command to set up the app.
```bash
fly launch
```
* **Important:** When it asks "Would you like to tweak these settings before proceeding?", choose **No**. (The included `fly.toml` already has all the required settings!)
* If it asks if you want to overwrite `fly.toml`, answer **No** to keep the existing configuration.

**3. Create the Persistent Volume for the Database:**
Because Fly.io uses ephemeral filesystems, you **must** create a volume so your SQLite database isn't deleted when the server restarts.

Run the following command to create a 1GB volume named `exampool_data` (this perfectly matches the `fly.toml` configuration):
```bash
fly volumes create exampool_data --size 1
```
*(When prompted for a region, select the same region your app was created in!)*

**4. Deploy the App:**
Now that the volume is created and the app is configured, deploy it!
```bash
fly deploy
```

**5. Open the App!**
Once the deployment finishes, simply run:
```bash
fly open
```

That's it! Your ExamPool application is now running securely on Fly.io with a persistent database.
