import axios from "axios";

// Map our language strings to Judge0 language_ids.
const LANGUAGE_IDS = {
  javascript: 63,
  python: 71,
  cpp: 54,
  java: 62,
  go: 60,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Judge0 status ids: 1 = In Queue, 2 = Processing.
const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 10;

// POST /api/execute  (protected, rate-limited)
export const execute = async (req, res) => {
  try {
    const { code, language, stdin } = req.body;

    if (!code || !language) {
      return res
        .status(400)
        .json({ message: "code and language are required" });
    }

    const languageId = LANGUAGE_IDS[language];
    if (!languageId) {
      return res
        .status(400)
        .json({ message: `Unsupported language: ${language}` });
    }

    const baseUrl = process.env.JUDGE0_URL || "https://ce.judge0.com";

    const headers = {
      "Content-Type": "application/json",
    };

    // Step 1: submit the code (no wait=true) and get back a token.
    const { data: submission } = await axios.post(
      `${baseUrl}/submissions?base64_encoded=false`,
      {
        source_code: code,
        language_id: languageId,
        stdin: stdin || "",
      },
      { headers, timeout: 20000 },
    );

    const token = submission.token;
    if (!token) {
      return res
        .status(500)
        .json({ message: "Execution failed", error: "No submission token returned" });
    }

    // Step 2: poll for the result until it's no longer queued/processing.
    let data = null;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const { data: result } = await axios.get(
        `${baseUrl}/submissions/${token}?base64_encoded=false`,
        { headers, timeout: 20000 },
      );

      const statusId = result.status?.id;
      if (statusId !== 1 && statusId !== 2) {
        data = result;
        break;
      }
    }

    if (!data) {
      return res.status(408).json({
        message: "Execution timed out — please try again.",
      });
    }

    return res.status(200).json({
      stdout: data.stdout,
      // compile_output surfaces compile-time errors (Java/C++/Go)
      stderr: data.stderr || data.compile_output,
      exitCode: data.exit_code,
      time: data.time,
      memory: data.memory,
      status: data.status?.description,
    });
  } catch (err) {
    console.error("Execute error:", err.response?.data || err.message);
    const msg = err.response?.data?.message || err.message;
    return res.status(500).json({ message: "Execution failed", error: msg });
  }
};
