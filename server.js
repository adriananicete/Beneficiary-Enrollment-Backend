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
app.set('trust proxy', false); // no reverse proxy in dev

app.use(helmet());
app.use(cors({
    origin: config.corsOrigin,
    credentials: true
}));
// A 1,000-address invitation upload is roughly 33KB. The default is 100kb, which
// would hold, but the limit should be deliberate rather than inherited.
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
    if (req.body === undefined) req.body = {};

    next();
});

app.use(cookieParser());

app.get('/', (req, res) => {
    res.send('Beneficiary Enrollment');
});

app.use('/api/auth', authRoutes);
app.use('/api/enrollment', enrollmentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employee', employeeRoutes);

app.use(errorHandler);

app.listen(config.PORT, "0.0.0.0", () => console.log(`Server is running on port ${config.PORT}`));
