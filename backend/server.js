const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

// ==========================================
// CLEAN AI RESPONSE FORMATTING
// ==========================================

function cleanAIText(text) {

  if (!text) return "";

  return String(text)

    // Remove bold Markdown
    .replace(/\*\*(.*?)\*\*/gs, "$1")

    // Remove underscore bold/italic
    .replace(/__(.*?)__/gs, "$1")
    .replace(/_(.*?)_/gs, "$1")

    // Remove Markdown headings
    .replace(/^\s*#{1,6}\s*/gm, "")

    // Convert Markdown bullets to clean bullets
    .replace(/^\s*[\*\-\+]\s+/gm, "• ")

    // Remove inline code formatting
    .replace(/`([^`]+)`/g, "$1")

    // Remove Markdown links but keep their text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")

    // Remove any remaining asterisks
    .replace(/\*/g, "")

    // Remove excessive blank lines
    .replace(/\n{3,}/g, "\n\n")

    .trim();
}

dotenv.config();

const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: "10mb" }));

/* =========================================================
   KISANIQ AUTHENTICATION
   ========================================================= */

const USERS_FILE =
  path.join(__dirname, "kisaniq-users.json");


const AUTH_SESSIONS =
  new Map();


function loadUsers(){

  try{

    if(
      !fs.existsSync(
        USERS_FILE
      )
    ){

      return [];

    }


    const data =
      fs.readFileSync(
        USERS_FILE,
        "utf8"
      );


    const users =
      JSON.parse(data);


    return Array.isArray(users)
      ? users
      : [];


  }catch(error){

    console.error(
      "User database error:",
      error
    );

    return [];

  }

}


function saveUsers(users){

  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify(
      users,
      null,
      2
    ),
    "utf8"
  );

}


/* Password hashing */

function hashPassword(password){

  const salt =
    crypto.randomBytes(16)
      .toString("hex");


  const hash =
    crypto
      .scryptSync(
        password,
        salt,
        64
      )
      .toString("hex");


  return {
    salt,
    hash
  };

}


function verifyPassword(
  password,
  storedHash,
  storedSalt
){

  const hash =
    crypto
      .scryptSync(
        password,
        storedSalt,
        64
      )
      .toString("hex");


  return crypto.timingSafeEqual(
    Buffer.from(hash,"hex"),
    Buffer.from(storedHash,"hex")
  );

}


function createSession(user){

  const token =
    crypto.randomBytes(32)
      .toString("hex");


  AUTH_SESSIONS.set(
    token,
    {
      userId:user.id,
      createdAt:Date.now()
    }
  );


  return token;

}


function getSessionUser(req){

  const auth =
    req.headers.authorization || "";


  if(
    !auth.startsWith(
      "Bearer "
    )
  ){

    return null;

  }


  const token =
    auth.slice(7);


  const session =
    AUTH_SESSIONS.get(token);


  if(!session)
    return null;


  const users =
    loadUsers();


  return (
    users.find(
      user =>
        user.id ===
        session.userId
    ) || null
  );

}


function publicUser(user){

  return {

    id:user.id,

    name:user.name,

    email:user.email,

    createdAt:user.createdAt

  };

}

/* =========================================================
   REGISTER
   ========================================================= */

app.post(
  "/api/auth/register",
  (req,res) => {

    try{

      const {
        name,
        email,
        password
      } = req.body;


      if(
        !name ||
        !email ||
        !password
      ){

        return res.status(400).json({
          error:
            "Name, email and password are required."
        });

      }


      if(
        password.length < 8
      ){

        return res.status(400).json({
          error:
            "Password must contain at least 8 characters."
        });

      }


      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();


      const users =
        loadUsers();


      const existing =
        users.find(
          user =>
            user.email ===
            normalizedEmail
        );


      if(existing){

        return res.status(409).json({
          error:
            "An account with this email already exists."
        });

      }


      const {
        salt,
        hash
      } =
        hashPassword(password);


      const user = {

        id:
          "user_" +
          crypto.randomBytes(12)
            .toString("hex"),

        name:
          String(name).trim(),

        email:
          normalizedEmail,

        passwordHash:
          hash,

        passwordSalt:
          salt,

        createdAt:
          new Date().toISOString()

      };


      users.push(user);

      saveUsers(users);


      const token =
        createSession(user);


      res.json({

        success:true,

        user:
          publicUser(user),

        token

      });


    }catch(error){

      console.error(
        "Register error:",
        error
      );


      res.status(500).json({

        error:
          "Unable to create account."

      });

    }

  }
);


/* =========================================================
   LOGIN
   ========================================================= */

app.post(
  "/api/auth/login",
  (req,res) => {

    try{

      const {
        email,
        password
      } = req.body;


      const normalizedEmail =
        String(email || "")
          .trim()
          .toLowerCase();


      const users =
        loadUsers();


      const user =
        users.find(
          item =>
            item.email ===
            normalizedEmail
        );


      if(!user){

        return res.status(401).json({
          error:
            "Invalid email or password."
        });

      }


      const valid =
        verifyPassword(
          password,
          user.passwordHash,
          user.passwordSalt
        );


      if(!valid){

        return res.status(401).json({
          error:
            "Invalid email or password."
        });

      }


      const token =
        createSession(user);


      res.json({

        success:true,

        user:
          publicUser(user),

        token

      });


    }catch(error){

      console.error(
        "Login error:",
        error
      );


      res.status(500).json({

        error:
          "Unable to sign in."

      });

    }

  }
);


/* =========================================================
   CURRENT USER
   ========================================================= */

app.get(
  "/api/auth/me",
  (req,res) => {

    const user =
      getSessionUser(req);


    if(!user){

      return res.status(401).json({
        error:
          "Not authenticated."
      });

    }


    res.json({

      success:true,

      user:
        publicUser(user)

    });

  }
);


/* =========================================================
   LOGOUT
   ========================================================= */

app.post(
  "/api/auth/logout",
  (req,res) => {

    const auth =
      req.headers.authorization || "";


    if(
      auth.startsWith(
        "Bearer "
      )
    ){

      const token =
        auth.slice(7);

      AUTH_SESSIONS.delete(
        token
      );

    }


    res.json({
      success:true
    });

  }
);


/* =========================================================
   DELETE ACCOUNT
   ========================================================= */

app.delete(
  "/api/auth/delete",
  (req,res) => {

    try{

      const user =
        getSessionUser(req);


      if(!user){

        return res.status(401).json({
          error:
            "Not authenticated."
        });

      }


      const users =
        loadUsers();


      const remaining =
        users.filter(
          item =>
            item.id !==
            user.id
        );


      saveUsers(
        remaining
      );


      const auth =
        req.headers.authorization || "";


      if(
        auth.startsWith(
          "Bearer "
        )
      ){

        AUTH_SESSIONS.delete(
          auth.slice(7)
        );

      }


      res.json({

        success:true

      });


    }catch(error){

      console.error(
        "Delete account error:",
        error
      );


      res.status(500).json({

        error:
          "Unable to delete account."

      });

    }

  }
);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

app.get("/", (req, res) => {
  res.json({
    status: "online",
    message: "KisanIQ AI Backend is running 🌾🤖"
  });
});

app.post("/api/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || !question.trim()) {
      return res.status(400).json({
        error: "Question is required"
      });
    }

    const prompt = `
You are KisanIQ, an AI agricultural assistant for Indian farmers.

Answer the farmer's question in simple, practical language.
Prefer Indian agricultural context.
Avoid unnecessary technical jargon.
If the question involves pesticides, fertilizers, disease treatment,
or other potentially harmful agricultural chemicals, give cautious
guidance and recommend checking the product label/local agricultural
expert before application.

Farmer's question:
${question}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt
    });

    res.json({
      answer: cleanAIText(response.text)
    });

  } catch (error) {
    console.error("Gemini error:", error);

    res.status(500).json({
      error: "Unable to get AI response",
      details: error.message
    });
  }
});
// ==========================================
// KISANIQ CROP DOCTOR - IMAGE ANALYSIS
// ==========================================

app.post("/api/analyze-crop", async (req, res) => {

  try {

    const { image, mimeType } = req.body;

    if (!image || !mimeType) {

      return res.status(400).json({
        error: "Crop image is required"
      });

    }

    const prompt = `
You are KisanIQ Crop Doctor, an AI agricultural assistant for Indian farmers.

Analyze this crop/plant image carefully.

Determine, only when reasonably visible:

1. Crop or plant
2. Most likely disease, pest, nutrient deficiency, or healthy condition
3. Confidence percentage
4. Visible symptoms
5. Recommended actions
6. Prevention advice

IMPORTANT:
- Do not claim certainty if the image is unclear.
- Do not invent symptoms.
- If the image is poor or the plant cannot be identified, clearly say so.
- Give practical advice suitable for Indian farmers.
- For pesticides or fungicides, advise following the product label and consulting a local agricultural expert.

Return the result in this format:

Condition: ...

Confidence: ...%

Crop: ...

Symptoms:
...

What to do:
1. ...
2. ...
3. ...

Prevention:
...

Note:
...

Formatting rules:
- Use plain text only.
- Do not use Markdown.
- Do not use asterisks.
- Do not use # symbols.
- Do not use backticks.
- Use simple section names.
- Use numbered lists for actions.
- Keep the response concise and farmer-friendly.
`;

    const response = await ai.models.generateContent({

      model: "gemini-3.6-flash",

      contents: [

        {
          inlineData: {
            mimeType: mimeType,
            data: image
          }
        },

        {
          text: prompt
        }

      ]

    });


    res.json({

      success: true,

      analysis: cleanAIText(response.text)

    });


  } catch (error) {

    console.error(
      "Crop Doctor error:",
      error
    );


    res.status(500).json({

      success: false,

      error:
        error.message ||
        "Crop analysis failed"

    });

  }

});

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`🌾 KisanIQ AI server running at http://localhost:${PORT}`);
});