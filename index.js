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
const DB_NAME = "daily_life_db";

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
          const db = client.db(DB_NAME);
          const lessonCollection = db.collection('lessons');
          const subscriptionCollection = db.collection('subscriptions');
          console.log("MongoDB Connected Successfully!");

          //  Better Auth Configuration
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
                         user: "user",                
                         session: "session",          
                         account: "account",          
                         verification: "verification" 
                    }
               }),
               user: {
                    additionalFields: {
                         role: {
                              type: "string",
                              defaultValue: "user"
                         },
                         isPremium: {
                              type: "boolean",
                              defaultValue: false
                         }
                    }
               },
               socialProviders: {
                    google: {
                         clientId: process.env.GOOGLE_CLIENT_ID,
                         clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    },
               },
          });

          const authRouter = express.Router();
          authRouter.use(toNodeHandler(auth));
          app.use("/api/auth", authRouter);

          app.get('/', (req, res) => {
               res.send("Daily Life Server is running correctly!");
          });

          // Subscription API
          app.post("/api/subscriptions", async (req, res) => {
               try {
                    const subscription = req.body;

                    if (!subscription || !subscription.email) {
                         return res.status(400).send({ success: false, message: "Email is missing!" });
                    }

                    const cleanEmail = subscription.email.trim().toLowerCase();
                    const planId = subscription.planId || "premium";

                    // "user" singular — matches what Better-Auth actually created in Atlas
                    const userCollection = db.collection('user');

                    const existingUser = await userCollection.findOne({ email: cleanEmail });

                    if (!existingUser) {
                         console.error(`No user found in DB with email: ${cleanEmail}`);
                         return res.status(404).send({
                              success: false,
                              message: `No user found with email: ${cleanEmail}.`
                         });
                    }

                    console.log(`User found: ${existingUser._id} (${existingUser.email})`);

                    const updateResult = await userCollection.updateOne(
                         { _id: existingUser._id },
                         {
                              $set: {
                                   isPremium: true,
                                   planId: planId,
                                   updatedAt: new Date()
                              }
                         }
                    );

                    if (updateResult.modifiedCount === 0) {
                         console.warn(" User found but not modified — may already be premium.");
                    } else {
                         console.log(` User ${cleanEmail} upgraded to premium successfully.`);
                    }

                    // Log subscription record
                    await subscriptionCollection.insertOne({
                         email: cleanEmail,
                         userId: existingUser._id,
                         planId: planId,
                         createdAt: new Date()
                    });

                    return res.send({
                         success: true,
                         message: "User upgraded to premium successfully!",
                         modifiedCount: updateResult.modifiedCount,
                         userId: existingUser._id
                    });

               } catch (error) {
                    console.error("Subscription update error:", error);
                    return res.status(500).send({ success: false, error: error.message });
               }
          });

          //users apis
          app.get("/api/users", async (req, res) => {
               const userCollection = db.collection('user');
               const result = await userCollection.find().toArray();
               res.send(result);
          });

          app.patch("/api/users/:id/role", async (req, res) => {
               const { id } = req.params;
               const { role } = req.body;
               const userCollection = db.collection('user');
               const query = { _id: new ObjectId(id) };
               const updateDoc = await userCollection.updateOne(
                    query, {
                         $set: {
                              role: role,
                              updatedAt: new Date()
                         }
               });
               if (updateDoc.matchedCount === 0) {
                    return res.status(404).send({ success: false, message: "User not found." });
               }
               console.log(`user ${id} role updated successfully to ${role}`);

               res.send(updateDoc);

               })

          

          // Lesson APIs
          app.post("/api/lessons", async (req, res) => {
               try {
                    const lesson = req.body;
                    const newLesson = { ...lesson, createdAt: new Date() };
                    const result = await lessonCollection.insertOne(newLesson);
                    res.send(result);
               } catch (error) {
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.get("/api/lessons", async (req, res) => {
               try {
                    const result = await lessonCollection.find().toArray();
                    res.send(result);
               } catch (error) {
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.get("/api/lessons/:id", async (req, res) => {
               try {
                    const id = req.params.id;
                    const query = { _id: new ObjectId(id) };
                    const result = await lessonCollection.findOne(query);
                    if (!result) {
                         return res.status(404).send({ success: false, message: "Lesson not found" });
                    }
                    res.send(result);
               } catch (error) {
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.get("/api/my-lessons/:creatorId", async (req, res) => {
               const { creatorId } = req.params
               myCreatedLessons = await lessonCollection.find({ creatorId }).toArray()
               res.send(myCreatedLessons)
          })


          //Like Toggle API
          app.patch("/api/lessons/:id/like", async (req, res) => {
               try {
                    const id = req.params.id;
                    const { userId } = req.body;

                    if (!userId) {
                         return res.status(400).send({ message: "User ID is required" });
                    }
                    const query = { _id: new ObjectId(id) };
                    const lesson = await lessonCollection.findOne(query);

                    if (!lesson) {
                         return res.status(404).send({ success: false, message: "Lesson not found" });
                    }

                    const hasLiked = lesson?.likes?.includes(userId);

                    const updateDoc = hasLiked
                         ? { $pull: { likes: userId }, $inc: { likesCount: -1 } }
                         : { $push: { likes: userId }, $inc: { likesCount: 1 } };

                    const result = await lessonCollection.updateOne(query, updateDoc);
                    res.send({ success: true, isLiked: !hasLiked, result });
               } catch (error) {
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          await client.db("admin").command({ ping: 1 });
          console.log("Database Pinged Successfully!");

     } catch (err) {
          console.error("Fatal Error during startup:", err);
          process.exit(1);
     }
}

run().catch(console.dir);

app.listen(PORT, () => {
     console.log(`Server running perfectly on port ${PORT}`);
});