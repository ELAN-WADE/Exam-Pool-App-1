try {
  const envFile = Bun.file(".env");
  if (await envFile.exists()) {
    const envText = await envFile.text();
    for (const line of envText.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join("=").trim();
        }
      }
    }
  }
} catch (e) {
  console.warn("Failed to load .env file:", e);
}