const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { toNodeHandler } = require("better-auth/node");

dotenv.config();

const PORT = process.env.PORT || 5000;

const uri = process.env.MONGODB_URI;

app.use(cors({
     origin: "http://localhost:3000",
     credentials: true 
}));
app.use(express.json());

const client = new MongoClient(uri, {
     serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
     }
});

async function run() {
     try {
          await client.connect();
          const db = client.db();
          const lessoncollection = db.collection('lessons')

          console.log("MongoDB Connected Successfully!");

          const auth = betterAuth({
               baseURL: "http://localhost:5000",
               trustedOrigins: ["http://localhost:3000"], 
               advanced: {
                    crossOrigin: true 
               },
               emailAndPassword: {
                    enabled: true
               },
               database: mongodbAdapter(db, {
                    client,
                    modelMapping: {
                         user: "users", 
                         session: "sessions",
                         account: "accounts",
                         verification: "verifications"
                    }
               }),
          });

          const authRouter = express.Router();
          authRouter.use(toNodeHandler(auth));
          app.use("/api/auth", authRouter);

          app.get('/', (req, res) => {
               res.send("Wonderlust Server is running correctly!");
          });

          app.post("/api/lessons", async(req, res) => {
               const lesson = req.body;
               const newLesson = {
                    ...lesson,
                    createdAt: new Date()
               }
               const result = await lessoncollection.insertOne(newLesson)
               res.send(result)
          })

          await client.db("admin").command({ ping: 1 });
          console.log(" Database Pinged Successfully!");

     } catch (err) {
          console.error("Fatal Error during startup:", err);
     }
}

run().catch(console.dir);

app.listen(PORT, () => {
     console.log(` Server running perfectly on port ${PORT}`);
});