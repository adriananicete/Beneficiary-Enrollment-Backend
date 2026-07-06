import express from 'express';
import config from './src/config/env.js';
import { poolPromise } from './src/config/db.js';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './src/routes/authRoutes.js'
import { verifyToken } from './src/middlewares/verifyToken.js';

const app = express();

app.use(express.json());
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));
app.use(cookieParser());

app.get('/', (req, res) => {
    res.send('Beneficiary Enrollment');
});

app.use('/api/auth', authRoutes);

app.listen(config.PORT, () => console.log(`Server is running on port ${config.PORT}`));
