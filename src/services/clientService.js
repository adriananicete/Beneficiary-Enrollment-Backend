import { poolPromise } from "../config/db.js";
import ClientModel from "../models/clientModel.js";


const createClient = async (clientData) => {
    const pool = await poolPromise;

    const clientId = await ClientModel.insertClient(pool, clientData);

    return clientId;
};

const editClient = async (clientData) => {
    const pool = await poolPromise;

    await ClientModel.updateClient(pool, clientData);
};

const getListClients = async (filters) => {
    const pool = await poolPromise;

    const clientList = await ClientModel.listClients(pool, filters);

    return clientList;
};

export default {
    createClient,
    editClient,
    getListClients
}