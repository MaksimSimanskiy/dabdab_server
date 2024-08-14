// server.js
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid'); // для уникальных имен файлов
const crypto = require('crypto'); // для генерации реферального кода

// Firebase Admin SDK
const serviceAccount = require('./firebase-config.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'your-project-id.appspot.com', // замените на ваш ID проекта
});

const bucket = admin.storage().bucket();

const app = express();
app.use(cors());
// Подключение к базе данных MongoDB
mongoose.connect('mongodb://localhost:27017/yourdb', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Настройка для загрузки файлов через multer
const upload = multer({ storage: multer.memoryStorage() });

// Определение схем
const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  completed: { type: Boolean, default: false },
  points: { type: Number, default: 0 }, // Очки за выполнение задания
  image: { type: String }, // URL изображения задания
});

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  tg_id: { type: String, unique: true, required: true }, // Telegram ID
  points: { type: Number, default: 0 },
  avatar: { type: String }, // URL аватарки пользователя
  tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }], // Ссылка на задания
  referral_code: { type: String, unique: true, required: false,default:0 }, // Уникальный реферальный код
  invited_by: { type: String }, // Реферальный код пригласившего пользователя
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

// Функция для генерации уникального реферального кода
const generateReferralCode = () => {
  return crypto.randomBytes(4).toString('hex'); // 8-символьный код
};

// Маршрут для добавления нового задания
app.post('/api/tasks', upload.single('image'), async (req, res) => {
  try {
    const imageUrl = await uploadImageToFirebase(req.file);
    const task = new TaskModel({
      title: req.body.title,
      points: req.body.points,
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
    const referralCode = generateReferralCode();

    const user = new UserModel({
      name: req.body.name,
      tg_id: req.body.tg_id,
      points: req.body.points || 0,
      avatar: avatarUrl,
      referral_code: referralCode,
      invited_by: req.body.invited_by || null,
    });

    const result = await user.save();
    res.status(201).json({ message: 'User created successfully', user: result });
  } catch (err) {
    res.status(500).json({ message: 'Error creating user', error: err });
  }
});

// Маршрут для получения пользователя по tg_id
app.get('/api/users/tg/:tg_id', (req, res) => {
  const tg_id = req.params.tg_id;
  const field = req.query.field; // Получаем поле из query параметров

  let query = UserModel.findOne({ tg_id });

  if (field) {
    query = query.select(field); // Указываем конкретное поле для выборки
  }

  query
    .then(user => {
      if (!user) {
        return res.status(200).json({ message: 'User not found' });
      }
      res.status(200).json(user);
    })
    .catch(err => {
      res.status(500).json({ message: 'Error fetching user', error: err });
    });
});

// Маршрут для получения заданий пользователя по tg_id
app.get('/api/users/tg/:tg_id/tasks', (req, res) => {
  const tg_id = req.params.tg_id;

  UserModel.findOne({ tg_id })
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

// Маршрут для получения топ пользователей по points
app.get('/api/users/top/:limit', (req, res) => {
  const limit = parseInt(req.params.limit, 10);

  UserModel.find()
    .sort({ points: -1 })
    .limit(limit)
    .then(users => {
      res.status(200).json(users);
    })
    .catch(err => {
      res.status(500).json({ message: 'Error fetching top users', error: err });
    });
});

// Маршрут для получения количества приглашённых пользователей по tg_id
app.get('/api/users/tg/:tg_id/referrals', (req, res) => {
  const tg_id = req.params.tg_id;

  UserModel.findOne({ tg_id })
    .then(user => {
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      return UserModel.countDocuments({ invited_by: user.referral_code });
    })
    .then(count => {
      res.status(200).json({ referralCount: count });
    })
    .catch(err => {
      res.status(500).json({ message: 'Error fetching referral count', error: err });
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
  const { completed } = req.body;

  UserModel.findOneAndUpdate(
    { _id: userId, 'tasks': taskId },
    { $set: { 'tasks.$.completed': completed } },
    { new: true }
  )
    .then(updatedUser => {
      if (!updatedUser) {
        return res.status(404).json({ message: 'User or task not found' });
      }
      res.status(200).json({ message: 'Task status updated', user: updatedUser });
    })
    .catch(err => {
      res.status(500).json({ message: 'Error updating task status', error: err });
    });
});

// Маршрут для обновления полей пользователя по tg_id
app.patch('/api/users/tg/:tg_id', (req, res) => {
  const tg_id = req.params.tg_id;
  const updateFields = req.body;

  UserModel.findOneAndUpdate({ tg_id }, { $set: updateFields }, { new: true })
    .then(updatedUser => {
      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.status(200).json({ message: 'User updated successfully', user: updatedUser });
    })
    .catch(err => {
      res.status(500).json({ message: 'Error updating user', error: err });
    });
});

// Маршрут для обновления полей задания по taskId
app.patch('/api/tasks/:taskId', (req, res) => {
  const taskId = req.params.taskId;
  const updateFields = req.body;

  TaskModel.findByIdAndUpdate(taskId, { $set: updateFields }, { new: true })
    .then(updatedTask => {
      if (!updatedTask) {
        return res.status(404).json({ message: 'Task not found' });
      }
      res.status(200).json({ message: 'Task updated successfully', task: updatedTask });
    })
    .catch(err => {
      res.status(500).json({ message: 'Error updating task', error: err });
    });
});

// Запуск сервера
app.listen(3002, () => {
  console.log('Server is running on port 3002');
});
