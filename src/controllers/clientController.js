import ClientService from "../services/clientService.js";

export const createClient = async (req, res, next) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      suffix,
      birthDate,
      birthPlace,
      nationality,
      tinId,
      civilStatus,
      gender,
      height,
      weight,
      sssGsisNo,
      contactNo,
      email,
      occupation,
      sourceOfIncome,
      signaturePath,
      createdBy,
    } = req.body;

    const clientData = {
      firstName,
      middleName,
      lastName,
      suffix,
      birthDate,
      birthPlace,
      nationality,
      tinId,
      civilStatus,
      gender,
      height,
      weight,
      sssGsisNo,
      contactNo,
      email,
      occupation,
      sourceOfIncome,
      signaturePath,
      createdBy,
    }
    const clientId = await ClientService.createClient(clientData);

    return res.status(201).json({
        success: true,
        data: client,
        message: `Client Id: ${clientId} was successfully created`
    })
  } catch (error) {
    next(error);
  }
};
