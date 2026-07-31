import express from 'express';
import config from './src/config/env.js';
import { poolPromise } from './src/config/db.js';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import authRoutes from './src/routes/authRoutes.js';
import enrollmentRoutes from './src/routes/enrollmentRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import employeeRoutes from './src/routes/employeeRoutes.js';
import {errorHandler} from './src/middlewares/errorHandler.js';
import helmet from 'helmet';

const app = express();

app.use(helmet());
app.use(express.json());
app.use(cors({
    origin: config.corsOrigin,
    credentials: true
}));
app.use(cookieParser());

app.get('/', (req, res) => {
    res.send('Beneficiary Enrollment');
});

app.use('/api/auth', authRoutes);
app.use('/api/enrollment', enrollmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employee', employeeRoutes);

app.use(errorHandler);

app.listen(config.PORT, () => console.log(`Server is running on port ${config.PORT}`));
