const express = require("express");
const fs = require("fs").promises;
const crypto = require("crypto");
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const moment = require("moment");

const app = express();
const port = 3000;

app.use(express.static("public"));
app.use(express.json());

const API_KEY = "PsXpkqT6xiz2yt-CcS9yYuhJWm7lVJ_ISVFGgzKXX9pXzSst";
const CONTENT_TYPE = "image/jpeg";
const OUTPUT_CONTENT_TYPE = "image/jpeg";
const TIMEOUT = 60000;
const BASE_URL = "https://developer.remini.ai/api";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

async function getImageMd5Content(buffer) {
    const md5Hash = crypto.createHash("md5").update(buffer).digest("base64");
    return { md5Hash, content: buffer };
}

async function downloadAndSaveImage(outputUrl) {
    const response = await axios.get(outputUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    return buffer;
}

app.post("/process-image", upload.single("image"), async (req, res) => {
    try {
        const apiKey = req.body.apiKey; // Ambil API Key dari permintaan
        if (!apiKey) {
            return res.status(400).json({ error: "API Key is required." });
        }

        const { md5Hash, content } = await getImageMd5Content(req.file.buffer);
        const client = axios.create({
            baseURL: BASE_URL,
            headers: { Authorization: `Bearer ${apiKey}` }, // Gunakan API Key dari permintaan
            timeout: TIMEOUT,
        });

        console.log("Submitting image ...");
        const submitTaskResponse = await client.post("/tasks", {
            tools: [
                { type: "face_enhance", mode: "base" },
                { type: "background_enhance", mode: "base" },
                { type: "color_enhance", mode: "new-york" }
            ],
            image_md5: md5Hash,
            image_content_type: CONTENT_TYPE,
            output_content_type: OUTPUT_CONTENT_TYPE,
        });

        const taskID = submitTaskResponse.data.task_id;
        const uploadURL = submitTaskResponse.data.upload_url;
        const uploadHeaders = submitTaskResponse.data.upload_headers;

        console.log("Uploading image to Google Cloud Storage ...");
        await axios.put(uploadURL, content, { headers: uploadHeaders });

        console.log(`Processing task: ${taskID} ...`);
        await client.post(`/tasks/${taskID}/process`);

        console.log(`Polling result for task: ${taskID} ...`);
        for (let i = 0; i < 50; i++) {
            const getTaskResponse = await client.get(`/tasks/${taskID}`);

            if (getTaskResponse.data.status === "completed") {
                console.log("Processing completed.")
                const processedImageBuffer = await downloadAndSaveImage(getTaskResponse.data.result.output_url);
                const formattedDate = moment().format("MM-DD-YYYY");
                const formattedTime = moment().format("HH-mm-ss");
                const outputImagePath = path.join(__dirname, "public", `output_${formattedDate}_${formattedTime}.jpg`);
                await fs.writeFile(outputImagePath, processedImageBuffer);
                return res.json(`/output_${formattedDate}_${formattedTime}.jpg`);                
            } else {
                if (getTaskResponse.data.status !== "processing") {
                    console.error("Found illegal status: " + getTaskResponse.data.status);
                    return res.status(500).json({ error: "Image processing failed." });
                }
                console.log("Processing, sleeping 2 seconds ...")
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }

        console.error("Timeout reached! :( ");
        return res.status(500).json({ error: "Image processing timeout." });
    } catch (error) {
        console.error("Error processing image:", error);
        return res.status(500).json({ error: "Image processing failed." });
    }
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
