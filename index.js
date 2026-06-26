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
          const reportCollection = db.collection('reports');
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

          app.get("/api/top-contributors", async (req, res) => {
               try {
                    const topContributors = await lessonCollection.aggregate([
                         {
                              $group: {
                                   _id: "$creatorId",
                                   totalLessons: { $sum: 1 },
                                   name: { $first: "$creatorName" },
                                   image: { $first: "$creatorImage" } 
                              }
                         },
                         {
                              $sort: { totalLessons: -1 }
                         },
                         {
                              $limit: 2
                         },
                         {
                              $project: {
                                   _id: 0,
                                   creatorId: "$_id",
                                   totalLessons: 1,
                                   name: 1,
                                   image: 1
                              }
                         }
                    ]).toArray();

                    res.send({ success: true, data: topContributors });
               } catch (error) {
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.get("/api/lessons/featured", async (req, res) => {
               try {
                    const query = { isFeatured: true };

                    const featuredLessons = await lessonCollection.find(query).toArray();

                    res.send(featuredLessons);
               } catch (error) {
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.delete("/api/lessons/:id", async (req, res) => {
               try {
                    const { id } = req.params; 
                    if (!ObjectId.isValid(id)) {
                         return res.status(400).send({ success: false, error: "Invalid ID format" });
                    }

                    const lessonQuery = { _id: new ObjectId(id) };
                    const lessonResult = await lessonCollection.deleteOne(lessonQuery);

                    const reportQuery = { lessonId: id };
                    await reportCollection.deleteMany(reportQuery);

                    res.send({
                         success: true,
                         deletedCount: lessonResult.deletedCount
                    });

               } catch (error) {
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.delete("/api/lessons/report/:id", async (req, res) => {
               try {
                    const { id } = req.params;

                    if (!id) {
                         return res.status(400).send({ success: false, error: "Lesson ID is required" });
                    }
                    const query = { lessonId: id };

                    const result = await reportCollection.deleteMany(query);

                    res.send({ success: true, deletedCount: result.deletedCount });
               } catch (error) {
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.post("/api/lessons/report", async (req, res) => {
               try {
                    const { lessonId, lessonTitle, lessonImageUrl, reporterUserId, reporterEmail, reason, createdAt } = req.body;

                    console.log("Report received:", req.body);
                    if (!ObjectId.isValid(lessonId)) {
                         return res.status(400).send({ success: false, error: "Invalid lessonId format" });
                    }

                    await reportCollection.insertOne({
                         lessonId,
                         lessonTitle,
                         lessonImageUrl,
                         reporterUserId,
                         reporterEmail,
                         reason,
                         createdAt: new Date(createdAt)
                    });

                    res.send({ success: true });
               } catch (error) {
                    console.error("Report error:", error);
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.get("/api/lessons/report", async (req, res) => {
               const result = await reportCollection.find().toArray();
               res.send(result);
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

          app.patch("/api/lessons/:id/like", async (req, res) => {
               try {
                    const id = req.params.id;
                    const { userId } = req.body;

                    if (!userId) {
                         return res.status(400).send({ message: "User ID is required" });
                    }

                    const alreadyLiked = await lessonCollection.findOne({
                         _id: new ObjectId(id),
                         likes: userId 
                    });

                    const updateDoc = alreadyLiked
                         ? { $pull: { likes: userId } }  
                         : { $push: { likes: userId } };

                    await lessonCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);

                    const updated = await lessonCollection.findOne(
                         { _id: new ObjectId(id) },
                         { projection: { likes: 1 } }
                    );

                    res.send({
                         success: true,
                         isLiked: !alreadyLiked,
                         likesCount: updated.likes?.length || 0 
                    });

               } catch (error) {
                    console.error("Backend Error:", error);
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.patch("/api/lessons/:id/save", async (req, res) => {
               try {
                    const id = req.params.id;
                    const { userId } = req.body;

                    if (!userId) {
                         return res.status(400).send({ message: "User ID is required" });
                    }

                    const alreadySaved = await lessonCollection.findOne({
                         _id: new ObjectId(id),
                         saves: userId
                    });

                    const updateDoc = alreadySaved
                         ? { $pull: { saves: userId } }
                         : { $push: { saves: userId } };

                    await lessonCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);

                    const updated = await lessonCollection.findOne(
                         { _id: new ObjectId(id) },
                         { projection: { saves: 1 } }
                    );

                    res.send({
                         success: true,
                         isSaved: !alreadySaved,
                         savesCount: updated.saves?.length || 0
                    });

               } catch (error) {
                    console.error("Backend Error:", error);
                    res.status(500).send({ success: false, error: error.message });
               }
          });

          app.post("/api/lessons/:id/comments", async (req, res) => {
               const { id } = req.params;
               const { userId, userName, userImage, text } = req.body;
               
               if(!userId || !text) {
                    return res.status(400).send({ success: false, message: "User ID and text are required" });
               }

               const comment = {
                    userId,
                    userName,
                    userImage,
                    text,
                    createdAt: new Date()
               }

               await lessonCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $push: { comments: comment } }
               );

               res.send({ success: true, comment });
          })

          //isFeatured true or false
          app.patch("/api/lessons/:id/featured", async (req, res) => {
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

                    const currentFeaturedState = lesson?.isFeatured || false;

                    const updateDoc = {
                         $set: { isFeatured: !currentFeaturedState }
                    };

                    const result = await lessonCollection.updateOne(query, updateDoc);

                    res.send({
                         success: true,
                         isFeatured: !currentFeaturedState,
                         result
                    });

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