const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto'); // для генерации реферального кода
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');


// Настройка для загрузки файлов через multer в папку images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'images'); // путь к папке для хранения изображений
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});


const upload = multer({ storage });

const app = express();
app.use(cors());
// Подключение к базе данных MongoDB
mongoose.connect('mongodb://dabdab:rAAtct9R@94.228.114.20:27017/yourdb')
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  completed: { type: Boolean, default: false },
  url: { type: String, required: false },
  points: { type: Number, default: 0 }, // Очки за выполнение задания
  image: { type: String }, // Имя файла изображения задания
});

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  tg_id: { type: String, unique: true, required: true }, // Telegram ID
  points: { type: Number, default: 0 },
  avatar: { type: String }, // Имя файла аватарки пользователя
  wallet:{ type:String,required: false},
  tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }], // Ссылка на задания
  referral_code: { type: String, unique: true, required: false, default: 0 }, // Уникальный реферальный код
  invited_by: { type: String }, // Реферальный код пригласившего пользователя
});

UserSchema.index({ points: -1 });

const UserModel = mongoose.model('User', UserSchema);
const TaskModel = mongoose.model('Task', TaskSchema);

app.use(bodyParser.json());

// Функция для генерации уникального реферального кода
const generateReferralCode = () => {
  return crypto.randomBytes(4).toString('hex'); // 8-символьный код
};

// Маршрут для добавления нового задания
// Маршрут для добавления нового задания
app.post('/api/tasks', async (req, res) => {
  try {
    // Получаем название изображения из тела запроса
    const imageName = req.body.image;
    const imageUrl = imageName ? `https://${req.get('host')}/images/${imageName}` : null;

    const task = new TaskModel({
      title: req.body.title,
      points: req.body.points,
      url: req.body.url,
      completed: req.body.completed,
      image: imageUrl, // Сохраняем ссылку на изображение
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
    const avatarUrl = req.file ? `${req.protocol}://${req.get('host')}/images/${req.file.filename}` : null;
    const referralCode = generateReferralCode();

    const user = new UserModel({
      name: req.body.name,
      tg_id: req.body.tg_id,
      points: req.body.points || 0,
      wallet: req.body.wallet || "nowallet",
      avatar: avatarUrl, // Сохраняем ссылку на аватар
      referral_code: referralCode,
      invited_by: req.body.invited_by || null,
    });

    const result = await user.save();
    res.status(201).json({ message: 'User created successfully', user: result });
  } catch (err) {
    res.status(500).json({ message: 'Error creating user', error: err });
  }
});
// Маршрут для получения поля пользователя по tg_id
app.get('/api/users/tg/:tg_id', (req, res) => {
  const tg_id = req.params.tg_id;
  const field = req.query.field;

  let query = UserModel.findOne({ tg_id });

  if (field) {
    query = query.select(field);
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
//список рефералов
app.get('/api/users/tg/:tg_id/referrals/details', (req, res) => {
  const tg_id = req.params.tg_id;

  UserModel.findOne({ tg_id })
    .then(user => {
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Ищем всех пользователей, у которых поле invited_by совпадает с referral_code данного пользователя
      return UserModel.find({ invited_by: user.referral_code });
    })
    .then(referrals => {
      res.status(200).json({ referrals });
    })
    .catch(err => {
      res.status(500).json({ message: 'Error fetching referral details', error: err });
    });
});

//получение ранга
app.get('/api/users/tg/:tg_id/rank', async (req, res) => {
  const tg_id = req.params.tg_id;

  try {
    const user = await UserModel.findOne({ tg_id });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Используем агрегацию для подсчета ранга пользователя
    const rankPipeline = [
      {
        $match: {
          points: { $gte: user.points } // Находим всех пользователей с очками >= очков пользователя
        }
      },
      {
        $count: "rank" // Считаем количество таких пользователей
      }
    ];

    const result = await UserModel.aggregate(rankPipeline);

    if (result.length > 0) {
      const rank = result[0].rank;
      res.status(200).json({ rank });
    } else {
      res.status(200).json({ rank: 1 }); // Если пользователь единственный с такими очками, то его ранг будет 1
    }

  } catch (err) {
    res.status(500).json({ message: 'Error calculating user rank', error: err });
  }
});

//one task
app.post('/api/users/tg/:tg_id/task', (req, res) => {
  const tg_id = req.params.tg_id;
  const taskId = req.body.taskId;
  UserModel.findOne({ tg_id: tg_id }) // Ищем пользователя по tg_id
    .then(user => {
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Проверяем, есть ли уже эта задача у пользователя
      if (user.tasks.includes(taskId)) {
        return res.status(400).json({ message: 'Task already assigned to user' });
      }

      user.tasks.push(taskId); // Добавляем задачу пользователю
      return user.save();
    })
    .then(updatedUser => {
      res.status(200).json({ message: 'Task added to user successfully', user: updatedUser });
    })
    .catch(err => {
      res.status(500).json({ message: 'Error adding task to user', error: err });
    });
});

//all tasks
app.post('/api/users/tg/:tg_id/tasks', async (req, res) => {
  const tg_id = req.params.tg_id;

    // Находим пользователя по tg_id
    const user = await UserModel.findOne({ tg_id: tg_id });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Получаем все задачи из коллекции tasks
    const allTasks = await TaskModel.find({});

    // Извлекаем идентификаторы всех задач
    const allTaskIds = allTasks.map(task => task._id);

    // Фильтруем задачи, которые ещё не добавлены пользователю
    const newTasks = allTaskIds.filter(taskId => !user.tasks.includes(taskId));

    // Добавляем новые задачи пользователю
    if (newTasks.length > 0) {
      user.tasks.push(...newTasks);
    }

    // Сохраняем обновленного пользователя
    const updatedUser = await user.save();

    // Популяризируем tasks перед отправкой ответа
    const populatedUser = await updatedUser.populate('tasks');

    res.status(200).json({
      message: 'All tasks added to user successfully',
      user: populatedUser
    });

  
});



// Маршрут для обновления статуса выполнения задания пользователем
app.put('/api/users/tg/:tg_id/tasks/:taskId', (req, res) => {
  const { tg_id, taskId } = req.params;
  const { completed } = req.body;

  UserModel.findOneAndUpdate(
    { tg_id: tg_id, 'tasks': taskId }, // Ищем пользователя по tg_id и обновляем статус задачи
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

// Маршрут для получения изображения по его имени
app.get('/images/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'images', filename);
  res.sendFile(filepath);
});

// Запуск сервера
app.listen(3002, () => {
  console.log('Server is running on port 3002');
});
