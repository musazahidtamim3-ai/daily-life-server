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
          app.get("/api/lessons", async (req, res) => {
               const result = await lessoncollection.find().toArray()
               res.send(result)
          })

          app.get("/api/lessons/:id", async (req, res) => {
               const id = req.params.id;
               const query = {
                    _id: new ObjectId(id)
               }
               const result = await lessoncollection.findOne(query)
               res.send(result)
          })

          //Like toggle logic
          app.patch("/api/lessons/:id/like", async (req, res) => {
                    const id = req.params.id;
                    const { userId } = req.body;

                    if (!userId) {
                         return res.status(400).send({ message: "User ID is required" });
                    }

                    const query = { _id: new ObjectId(id) };
                    const lesson = await lessoncollection.findOne(query);
                    const hasLiked = lesson?.likes?.includes(userId);

                    let updateDoc;
                    if (hasLiked) {
                         updateDoc = {
                              $pull: { likes: userId },
                              $inc: { likesCount: -1 }
                         };
                    }
                    else {
                         updateDoc = {
                              $push: { likes: userId },
                              $inc: { likesCount: 1 }
                         };
                    }

                    const result = await lessoncollection.updateOne(query, updateDoc);
                    res.send({ success: true, isLiked: !hasLiked, result });

          });

     

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