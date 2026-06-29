const express = require("express");
const app = express();
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const { betterAuth } = require("better-auth");
const { mongodbAdapter } = require("better-auth/adapters/mongodb");
const { toNodeHandler } = require("better-auth/node");

dotenv.config();

const uri = process.env.MONGODB_URI;
const DB_NAME = "daily_life_db";

// CORS Fix for both local and production
app.use(cors({
     origin: ["http://localhost:3000", "https://daily-life-client.vercel.app"],
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

let db, lessonCollection, subscriptionCollection, reportCollection, auth;

// Database connection helper for Serverless
async function connectDB() {
     if (!db) {
          await client.connect();
          db = client.db(DB_NAME);
          lessonCollection = db.collection('lessons');
          subscriptionCollection = db.collection('subscriptions');
          reportCollection = db.collection('reports');

          // Better Auth Initialization
          auth = betterAuth({
               baseURL: "https://daily-life-server.vercel.app/",
               trustedOrigins: ["https://daily-life-client.vercel.app/"],
               advanced: { crossOrigin: true },
               emailAndPassword: { enabled: true },
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
                         role: { type: "string", defaultValue: "user" },
                         isPremium: { type: "boolean", defaultValue: false }
                    }
               },
               socialProviders: {
                    google: {
                         clientId: process.env.GOOGLE_CLIENT_ID,
                         clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                    },
               },
          });

          // Auth Route Middleware inside connection
          const authRouter = express.Router();
          authRouter.use(toNodeHandler(auth));
          app.use("/api/auth", authRouter);
     }
}

// Middleware to ensure DB is connected before handling requests
app.use(async (req, res, next) => {
     try {
          await connectDB();
          next();
     } catch (err) {
          res.status(500).send({ success: false, error: "Database connection failed" });
     }
});

// --- YOUR APIS START HERE ---
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
               return res.status(404).send({ success: false, message: `No user found with email: ${cleanEmail}.` });
          }

          const updateResult = await userCollection.updateOne(
               { _id: existingUser._id },
               { $set: { isPremium: true, planId: planId, updatedAt: new Date() } }
          );

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
          return res.status(500).send({ success: false, error: error.message });
     }
});

// User APIs
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
     const updateDoc = await userCollection.updateOne(query, {
          $set: { role: role, updatedAt: new Date() }
     });
     if (updateDoc.matchedCount === 0) {
          return res.status(404).send({ success: false, message: "User not found." });
     }
     res.send(updateDoc);
});

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
          const page = parseInt(req.query.page) || 1;
          const limit = parseInt(req.query.limit) || 4;
          const skipAmount = (page - 1) * limit;
          const searchKeyword = req.query.search || "";
          const categoryFilter = req.query.category || "";
          const emotionalTones = req.query.emotionalTone || "";

          let query = {};
          if (searchKeyword) {
               query = {
                    $or: [
                         { title: { $regex: searchKeyword, $options: "i" } },
                         { category: { $regex: searchKeyword, $options: "i" } }
                    ]
               };
          }
          if (categoryFilter) query.category = categoryFilter;
          if (emotionalTones) query.emotionalTone = emotionalTones;

          const result = await lessonCollection.find(query).skip(skipAmount).limit(limit).toArray();
          const totalLessons = await lessonCollection.countDocuments(query);
          const totalPages = Math.ceil(totalLessons / limit);

          res.send({
               success: true,
               data: result,
               meta: { currentPage: page, totalPages, totalLessons }
          });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.get("/api/top-contributors", async (req, res) => {
     try {
          const topContributors = await lessonCollection.aggregate([
               { $group: { _id: "$creatorId", totalLessons: { $sum: 1 }, name: { $first: "$creatorName" }, image: { $first: "$creatorImage" } } },
               { $sort: { totalLessons: -1 } },
               { $limit: 2 },
               { $project: { _id: 0, creatorId: "$_id", totalLessons: 1, name: 1, image: 1 } }
          ]).toArray();
          res.send({ success: true, data: topContributors });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.get('/api/analytics/:userId', async (req, res) => {
     try {
          const { userId } = req.params;
          let queryConditions = [{ creatorId: userId }];
          if (ObjectId.isValid(userId)) {
               queryConditions.push({ creatorId: new ObjectId(userId) });
          }
          const lessons = await lessonCollection.find({ $or: queryConditions }).toArray();
          const daysMap = {
               0: { name: "Sun", created: 0, saved: 0 },
               1: { name: "Mon", created: 0, saved: 0 },
               2: { name: "Tue", created: 0, saved: 0 },
               3: { name: "Wed", created: 0, saved: 0 },
               4: { name: "Thu", created: 0, saved: 0 },
               5: { name: "Fri", created: 0, saved: 0 },
               6: { name: "Sat", created: 0, saved: 0 }
          };

          lessons.forEach(lesson => {
               if (lesson.createdAt) {
                    const dayIndex = new Date(lesson.createdAt).getDay();
                    if (daysMap[dayIndex] !== undefined) {
                         daysMap[dayIndex].created += 1;
                         daysMap[dayIndex].saved += Number(lesson.savesCount) || 0;
                    }
               }
          });
          res.json({ success: true, data: [daysMap[1], daysMap[2], daysMap[3], daysMap[4], daysMap[5], daysMap[6], daysMap[0]] });
     } catch (error) {
          res.status(500).json({ success: false, error: error.message });
     }
});

app.get("/api/stats/growth", async (req, res) => {
     try {
          const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          const lessonGrowth = await lessonCollection.aggregate([
               { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, lessons: { $sum: 1 } } },
               { $sort: { "_id.year": 1, "_id.month": 1 } }
          ]).toArray();

          const userGrowth = await db.collection("user").aggregate([
               { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, users: { $sum: 1 } } },
               { $sort: { "_id.year": 1, "_id.month": 1 } }
          ]).toArray();

          const merged = {};
          lessonGrowth.forEach(item => {
               const key = `${item._id.year}-${item._id.month}`;
               merged[key] = { name: months[item._id.month - 1], lessons: item.lessons, users: 0 };
          });
          userGrowth.forEach(item => {
               const key = `${item._id.year}-${item._id.month}`;
               if (merged[key]) merged[key].users = item.users;
               else merged[key] = { name: months[item._id.month - 1], lessons: 0, users: item.users };
          });

          res.send({ success: true, data: Object.values(merged) });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.get("/api/lessons/featured", async (req, res) => {
     try {
          const featuredLessons = await lessonCollection.find({ isFeatured: true }).toArray();
          res.send(featuredLessons);
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.get("/api/lessons/today", async (req, res) => {
     try {
          const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
          const result = await lessonCollection.find({ createdAt: { $gte: startOfDay, $lte: endOfDay } }).toArray();
          res.send({ success: true, data: result });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.delete("/api/lessons/:id", async (req, res) => {
     try {
          const { id } = req.params;
          if (!ObjectId.isValid(id)) return res.status(400).send({ success: false, error: "Invalid ID format" });
          const lessonResult = await lessonCollection.deleteOne({ _id: new ObjectId(id) });
          await reportCollection.deleteMany({ lessonId: id });
          res.send({ success: true, deletedCount: lessonResult.deletedCount });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.patch("/api/lessons/:id", async (req, res) => {
     try {
          const { id } = req.params;
          const result = await lessonCollection.updateOne({ _id: new ObjectId(id) }, { $set: req.body });
          if (result.matchedCount === 0) return res.status(404).send({ success: false, error: "Lesson not found" });
          res.send({ success: true, message: "Lesson updated successfully" });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.patch('/api/lessons/:id/status', async (req, res) => {
     try {
          const { id } = req.params;
          const { visibility, access } = req.body;
          if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, error: "Invalid Lesson ID format" });

          let updateFields = {};
          if (visibility !== undefined) updateFields.visibility = visibility;
          if (access !== undefined) updateFields.accessLevel = access;

          const result = await lessonCollection.updateOne({ _id: new ObjectId(id) }, { $set: updateFields });
          res.json({ success: true, message: "Status updated successfully", updatedFields });
     } catch (error) {
          res.status(500).json({ success: false, error: error.message });
     }
});

app.delete("/api/lessons/report/:id", async (req, res) => {
     try {
          const { id } = req.params;
          const result = await reportCollection.deleteMany({ lessonId: id });
          res.send({ success: true, deletedCount: result.deletedCount });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.post("/api/lessons/report", async (req, res) => {
     try {
          const { lessonId, lessonTitle, lessonImageUrl, reporterUserId, reporterEmail, reason, createdAt } = req.body;
          if (!ObjectId.isValid(lessonId)) return res.status(400).send({ success: false, error: "Invalid lessonId format" });

          await reportCollection.insertOne({
               lessonId, lessonTitle, lessonImageUrl, reporterUserId, reporterEmail, reason, createdAt: new Date(createdAt)
          });
          res.send({ success: true });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.get("/api/lessons/report", async (req, res) => {
     const result = await reportCollection.find().toArray();
     res.send(result);
});

app.get("/api/lessons/most-saved", async (req, res) => {
     try {
          const result = await lessonCollection.aggregate([
               { $addFields: { savesCount: { $size: { $ifNull: ["$saves", []] } } } },
               { $sort: { savesCount: -1 } },
               { $limit: 5 }
          ]).toArray();
          res.send({ success: true, data: result });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.get("/api/lessons/saved/:userId", async (req, res) => {
     try {
          const result = await lessonCollection.find({ saves: req.params.userId }).toArray();
          res.send({ success: true, data: result });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.get("/api/lessons/:id", async (req, res) => {
     try {
          const result = await lessonCollection.findOne({ _id: new ObjectId(req.params.id) });
          if (!result) return res.status(404).send({ success: false, message: "Lesson not found" });
          res.send(result);
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.get("/api/my-lessons/:creatorId", async (req, res) => {
     const myCreatedLessons = await lessonCollection.find({ creatorId: req.params.creatorId }).toArray();
     res.send(myCreatedLessons);
});

app.patch("/api/lessons/:id/like", async (req, res) => {
     try {
          const id = req.params.id;
          const { userId } = req.body;
          const alreadyLiked = await lessonCollection.findOne({ _id: new ObjectId(id), likes: userId });
          const updateDoc = alreadyLiked ? { $pull: { likes: userId } } : { $push: { likes: userId } };

          await lessonCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
          const updated = await lessonCollection.findOne({ _id: new ObjectId(id) }, { projection: { likes: 1 } });
          res.send({ success: true, isLiked: !alreadyLiked, likesCount: updated.likes?.length || 0 });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.patch("/api/lessons/:id/save", async (req, res) => {
     try {
          const id = req.params.id;
          const { userId } = req.body;
          const alreadySaved = await lessonCollection.findOne({ _id: new ObjectId(id), saves: userId });
          const updateDoc = alreadySaved ? { $pull: { saves: userId } } : { $push: { saves: userId } };

          await lessonCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
          const updated = await lessonCollection.findOne({ _id: new ObjectId(id) }, { projection: { saves: 1 } });
          res.send({ success: true, isSaved: !alreadySaved, savesCount: updated.saves?.length || 0 });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});

app.post("/api/lessons/:id/comments", async (req, res) => {
     const { id } = req.params;
     const { userId, userName, userImage, text } = req.body;
     const comment = { userId, userName, userImage, text, createdAt: new Date() };
     await lessonCollection.updateOne({ _id: new ObjectId(id) }, { $push: { comments: comment } });
     res.send({ success: true, comment });
});

app.patch("/api/lessons/:id/featured", async (req, res) => {
     try {
          const id = req.params.id;
          const { isFeatured } = req.body;
          const query = { _id: new ObjectId(id) };
          const lesson = await lessonCollection.findOne(query);

          const nextFeaturedState = typeof isFeatured === 'boolean' ? isFeatured : !(lesson?.isFeatured || false);
          const result = await lessonCollection.updateOne(query, { $set: { isFeatured: nextFeaturedState } });
          res.send({ success: true, isFeatured: nextFeaturedState, result });
     } catch (error) {
          res.status(500).send({ success: false, error: error.message });
     }
});
module.exports = app;

// Only listen when running locally
if (process.env.NODE_ENV !== 'production') {
     const PORT = process.env.PORT || 5000;
     app.listen(PORT, () => {
          console.log(`Server running locally on port ${PORT}`);
     });
}