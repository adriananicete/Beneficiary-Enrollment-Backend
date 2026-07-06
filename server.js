import express from 'express';

const PORT = process.env.PORT || 7001
const app = express();

app.get('/', (req, res) => {
    res.send('Hello world');
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
