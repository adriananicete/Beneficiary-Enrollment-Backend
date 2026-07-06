import express from 'express';
import config from './src/config/env.js';
import { poolPromise } from './src/config/db.js';
import router from './src/routes/authRoutes.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }))

app.get('/', (req, res) => {
    res.send('Beneficiary Enrollment');
});

app.use('/api/auth', adminRoutes)

app.listen(config.PORT, () => console.log(`Server is running on port ${config.PORT}`));
