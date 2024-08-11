// server.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid'); // для уникальных имен файлов

// Firebase Admin SDK
const serviceAccount = require('./firebase-config.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'dabdab-dcda2.appspot.com', // замените на ваш ID проекта
});

const bucket = admin.storage().bucket();

const app = express();

// Подключение к базе данных MongoDB
mongoose.connect('mongodb://localhost:27017/yourdb');

// Настройка для загрузки файлов через multer
const upload = multer({ storage: multer.memoryStorage() });

// Определение схем
const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  points: { type: Number, required: true ,default: 0 },
  completed: { type: Boolean, default: false },
  image: { type: String }, // URL изображения задания
});

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  points: { type: Number, default: 0 },
  avatar: { type: String }, // URL аватарки пользователя
  tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }], // Ссылка на задания
});

// Определение моделей
const UserModel = mongoose.model('User', UserSchema);
const TaskModel = mongoose.model('Task', TaskSchema);

app.use(bodyParser.json());

// Функция для загрузки файла в Firebase Storage и получения URL
const uploadImageToFirebase = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    const blob = bucket.file(`${uuidv4()}${path.extname(file.originalname)}`);
    const blobStream = blob.createWriteStream({
      metadata: {
        contentType: file.mimetype,
      },
    });

    blobStream.on('error', (err) => {
      reject(err);
    });

    blobStream.on('finish', async () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      resolve(publicUrl);
    });

    blobStream.end(file.buffer);
  });
};

// Маршрут для добавления нового задания
app.post('/api/tasks', upload.single('image'), async (req, res) => {
  try {
    const imageUrl = await uploadImageToFirebase(req.file);
    const task = new TaskModel({
      title: req.body.title,
      points: req.body.points || 0,
      image: imageUrl,
    });

    const result = await task.save();
    res.status(201).json({ message: 'Task created successfully', task: result });
  } catch (err) {
    res.status(500).json({ message: 'Error creating task', error: err });
  }
});

// Маршрут для получения всех заданий
app.get('/api/tasks', (req, res) => {
  TaskModel.find()
    .then(tasks => {
      res.status(200).json(tasks);
    })
    .catch(err => {
      res.status(500).json({ message: 'Error fetching tasks', error: err });
    });
});

// Маршрут для добавления нового пользователя
app.post('/api/users', upload.single('avatar'), async (req, res) => {
  try {
    const avatarUrl = await uploadImageToFirebase(req.file);
    const user = new UserModel({
      name: req.body.name,
      points: req.body.points || 0,
      avatar: avatarUrl,
    });

    const result = await user.save();
    res.status(201).json({ message: 'User created successfully', user: result });
  } catch (err) {
    res.status(500).json({ message: 'Error creating user', error: err });
  }
});

// Маршрут для получения всех пользователей
app.get('/api/users', (req, res) => {
  UserModel.find()
    .then(users => {
      res.status(200).json(users);
    })
    .catch(err => {
      res.status(500).json({ message: 'Error fetching users', error: err });
    });
});

// Маршрут для добавления задания пользователю из списка существующих
app.post('/api/users/:id/tasks', (req, res) => {
  const userId = req.params.id;
  const taskId = req.body.taskId;

  UserModel.findById(userId)
    .then(user => {
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      user.tasks.push(taskId);
      return user.save();
    })
    .then(updatedUser => {
      res.status(200).json({ message: 'Task added to user successfully', user: updatedUser });
    })
    .catch(err => {
      res.status(500).json({ message: 'Error adding task to user', error: err });
    });
});

// Маршрут для обновления статуса выполнения задания пользователем
app.put('/api/users/:userId/tasks/:taskId', (req, res) => {
  const { userId, taskId } = req.params;
  const { completed, points } = req.body;

  UserModel.findOneAndUpdate(
    { _id: userId, 'tasks': taskId },
    { $set: { 'tasks.$.completed': completed } },
    { $set: { 'tasks.$.points': points } },
    { new: true }
  )
    .then(updatedUser => {
      if (!updatedUser) {
        return res.status(404).json({ message: 'User or task not found' });
      }
      res.status(200).json({ message: 'Task status updated', user: updatedUser });
    })
    .catch(err => {
      res.status(500).json({ message: 'Error updating task', error: err });
    });
});

// Маршрут для получения всех заданий пользователя
app.get('/api/users/:id/tasks', (req, res) => {
  const userId = req.params.id;

  UserModel.findById(userId)
    .populate('tasks')
    .then(user => {
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.status(200).json(user.tasks);
    })
    .catch(err => {
      res.status(500).json({ message: 'Error fetching user tasks', error: err });
    });
});

app.listen(3002, () => {
  console.log('Server is running on port 3002');
});
