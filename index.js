const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const jwt = require("jsonwebtoken");
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "Unauthorized Access" });
  }
  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send("Unauthorized Access");
  }
  jwt.verify(token, process.env.JWT_ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      res.status(401).send("UnAuthorized Access");
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASS}@cluster0.h0arnkr.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const userCollection = client.db("rhythmicDB").collection("users");
    const classCollection = client.db("rhythmicDB").collection("classes");
    const paymentCollection = client.db("rhythmicDB").collection("payments");
    const selectedClassCollection = client.db("rhythmicDB").collection("selectedClass");

    // JWT
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_ACCESS_TOKEN, {
        expiresIn: "2h",
      });
      res.send({ token });
    });
    // users collection
    app.get("/users", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
    app.get("/instructor", async (req, res) => {
      const instructors = await userCollection
        .find({ role: "instructor" })
        .toArray();
      const instructorEmails = instructors.map(
        (instructor) => instructor.email
      );
      const specificClasses = await classCollection
        .aggregate([
          {
            $match: {
              instructorEmail: { $in: instructorEmails },
            },
          },
        ])
        .toArray();
      res.send(specificClasses);
    });
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const checkUser = await userCollection.findOne(query);
      if (checkUser) {
        return res.send("User Already Exists");
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    app.get("/users/role", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (req.decoded.email !== email) {
        return res.send({ admin: false });
      }
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { role: user?.role };
      res.send({ result });
    });
    app.patch("/users/roleUpdate", async (req, res) => {
      const id = req.query.id;
      const role = req.query.role;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: role,
        },
      };
      const result = await userCollection.updateOne(query, updatedDoc);
      res.send(result);
    });
    // selectedClass collection
    app.get("/selectedClass", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const filter = { email: email };
      const result = await selectedClassCollection.find(filter).toArray();
      res.send(result);
    });
    app.post("/selectedClass", async (req, res) => {
      const selectedClass = req.body;
      const result = await selectedClassCollection.insertOne(selectedClass);
      res.send(result);
    });
    app.delete("/deleteClass", async (req, res) => {
      const id = req.query.id;
      const filter = { _id: new ObjectId(id) };
      const result = await selectedClassCollection.deleteOne(filter);
      res.send(result);
    });
    // class collections
    app.get("/classes", async (req, res) => {
      const result = await classCollection.find().toArray();
      res.send(result);
    });
    app.get("/instructorClass", verifyJWT, async (req, res) => {
      const email = req.query.email;
      console.log(email, req.decoded.email);
      if (req.decoded.email !== email) {
        return res.send([]);
      }
      const query = { instructorEmail: email };
      const result = await classCollection.find(query).toArray();
      res.send(result);
    });
    app.post("/classes", async (req, res) => {
      const newClass = req.body;
      const result = await classCollection.insertOne(newClass);
      res.send(result);
    });
    app.patch("/classes/updateStatus", async (req, res) => {
      const id = req.query.id;
      const status = req.query.status;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status,
        },
      };
      const result = await classCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });
    app.patch("/classes/feedback", async (req, res) => {
      const feedback = req.body;
      const id = req.query.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          feedback: feedback,
        },
      };
      const options = { upsert: true };
      const result = await classCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });



    // payment intent

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // payment api 
    app.post('/payment', async (req, res) => {
      const payment = req.body.savedPayment;
      const insertedResult = await paymentCollection.insertOne(payment);
      const query = { _id: new ObjectId(payment._id) }
      const deletedResult = await selectedClassCollection.deleteOne(query);
      const filter = {_id: new ObjectId(payment.classId)}
      const enrolledClass = await classCollection.findOne(filter);
      console.log(enrolledClass);
      const updatedDoc = {
        $set: {
          enrolled: enrolledClass.enrolled + 1,
          availableSeats: enrolledClass.availableSeats - 1
        }
      }
      console.log(updatedDoc);
      const updatedResult = await classCollection.updateOne(filter, updatedDoc)
      res.send({insertedResult, deletedResult, updatedResult})
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Rhythmic Hub Server");
});

app.listen(port, () => {
  console.log(port);
});
