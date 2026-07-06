import express from 'express';
import config from './src/config/env.js';
import { poolPromise } from './src/config/db.js';

const app = express();

app.get('/', (req, res) => {
    res.send('Beneficiary Enrollment');
});

app.listen(config.PORT, () => console.log(`Server is running on port ${config.PORT}`));
