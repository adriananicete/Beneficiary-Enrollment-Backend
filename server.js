import express from 'express';
import config from './src/config/env.js';
import { getPool } from './src/config/db.js';
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

// Declared once so a future v2 is a new mount rather than a search for every
// literal. The version is not environment-driven on purpose — it describes the
// contract, not where the contract is running.
const API_PREFIX = '/api/v1';

app.get('/', (req, res) => {
    res.send('Beneficiary Enrollment API v1');
});

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/enrollment`, enrollmentRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/employee`, employeeRoutes);

// Anything still calling the unversioned paths is told where to go. Without
// this a stale caller gets a bare 404 that looks like a deleted endpoint rather
// than a moved one, which is a slow thing to work out from the outside.
//
// Declared after the mounts above, and it steps aside for /api/v1 so that a
// genuine 404 inside v1 — a real typo, or the wrong method — is not answered
// with advice to add a prefix that is already there.
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/v1')) return next();

    return res.status(404).json({
        success: false,
        message: `This API is versioned. Use ${API_PREFIX}${req.path} instead.`,
    });
});

app.use(errorHandler);

// The connection is made here rather than at import of src/config/db.js, so a
// database that cannot be reached is a server that refuses to start instead of
// a module that kills whatever imported it — the test runner included. The
// behaviour on this path is unchanged: no database, no boot.
try {
    await getPool();
} catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
}

app.listen(config.PORT, "0.0.0.0", () => console.log(`Server is running on port ${config.PORT}`));
