import express from "express";
import { allowedRoles } from "../middlewares/allowedRoles.js";
import { pendingCountLimiter } from "../middlewares/rateLimiter.js";
import { validateIdParam } from "../middlewares/validateIdParam.js";
import InvitationModel from "../models/invitationModel.js";
import { parsePaging } from "../utils/parsePaging.js";
import { ADMIN, SUPER_ADMIN } from "../utils/constants.js";
import {
  applicationDetails,
  decideApplication,
  editApplication,
  getApplication,
  isApplicationId,
  listApplications,
  pendingApplicationCount,
} from "./applications.js";
import { getPlans } from "./companies.js";

// The routes Group Credit Life adds (docs/backend-handoff.md 2.12 A and C), mounted at
// /admin by server.js only while the dev store is on. Built from the two things a test
// replaces, the session check and the pool, the way verifyToken.js is.

const applicationId = validateIdParam("client_id", "Application not found");

// HR's companies, the only ones whose applications HR may see.
const employerIdsOf = async (getPool, userId) => {
  const employers = await InvitationModel.getEmployersByUser(await getPool(), userId);
  return employers.map((employer) => String(employer.employer_id));
};

// A route handler that answers with `data`, and hands any failure to the error handler.
const answers = (status, work) => async (req, res, next) => {
  try {
    const result = await work(req);
    return res.status(status).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

// Lets a request whose id is not an application's pass to the usual route, which is
// where an enrollment's details are answered.
const onlyApplications = (req, res, next) => (isApplicationId(req.params.client_id) ? next() : next("route"));

export const createGcliRoutes = ({ verifyToken, getPool }) => {
  const router = express.Router();

  // Every plan, for the Administrator's dropdown.
  router.get(
    "/plans",
    verifyToken,
    allowedRoles(SUPER_ADMIN),
    answers(200, async () => getPlans(await getPool())),
  );

  // Declared before /:client_id on purpose, as the other pending-count routes are.
  router.get(
    "/enrollment-approvals/pending-count",
    verifyToken,
    allowedRoles(ADMIN),
    pendingCountLimiter,
    answers(200, async (req) => ({
      pendingCount: pendingApplicationCount(await employerIdsOf(getPool, req.user.user_id)),
    })),
  );

  router.get(
    "/enrollment-approvals",
    verifyToken,
    allowedRoles(ADMIN),
    answers(200, async (req) =>
      listApplications({
        employerIds: await employerIdsOf(getPool, req.user.user_id),
        tab: req.query.status ?? "waiting",
        ...parsePaging(req.query),
      }),
    ),
  );

  router.get(
    "/enrollment-approvals/:client_id",
    verifyToken,
    allowedRoles(ADMIN),
    applicationId,
    answers(200, async (req) =>
      getApplication(req.params.client_id, await employerIdsOf(getPool, req.user.user_id)),
    ),
  );

  router.patch(
    "/enrollment-approvals/:client_id",
    verifyToken,
    allowedRoles(ADMIN),
    applicationId,
    answers(200, async (req) =>
      editApplication({
        clientId: req.params.client_id,
        employerIds: await employerIdsOf(getPool, req.user.user_id),
        changes: req.body?.changes,
        reason: req.body?.reason,
        by: req.user.username,
      }),
    ),
  );

  for (const action of ["approve", "return", "reject"]) {
    router.post(
      `/enrollment-approvals/:client_id/${action}`,
      verifyToken,
      allowedRoles(ADMIN),
      applicationId,
      answers(200, async (req) =>
        decideApplication({
          clientId: req.params.client_id,
          employerIds: await employerIdsOf(getPool, req.user.user_id),
          action,
          effectivityDate: req.body?.effectivity_date,
          note: req.body?.note,
          by: req.user.username,
        }),
      ),
    );
  }

  // View Details of an application on the Dashboard, which has no enrollment behind it.
  router.get(
    "/enrollments/:client_id",
    onlyApplications,
    verifyToken,
    allowedRoles(ADMIN),
    answers(200, async (req) =>
      applicationDetails(req.params.client_id, await employerIdsOf(getPool, req.user.user_id)),
    ),
  );

  return router;
};

export default { createGcliRoutes };
