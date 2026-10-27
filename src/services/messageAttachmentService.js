import { sql } from "../config/db.js";
import MessageModel from "../models/messageModel.js";
import AttachmentModel, { attachmentOf } from "../models/messageAttachmentModel.js";
import { messageOf } from "./messageService.js";
import { emitToConversation } from "../realtime/realtime.js";
import { AppError } from "../utils/AppError.js";

// One transaction stores the message and its bytes. Announce only after commit.
export const makeAttachmentSender = ({
  createTransaction = pool => new sql.Transaction(pool),
  messages = MessageModel,
  attachments = AttachmentModel,
  announce = emitToConversation,
} = {}) => async (pool,{conversationId,userId,body,file}) => {
  const {conversation} = await messages.getConversationById(pool,conversationId,userId,{limit:1});
  if(!conversation) throw new AppError("Conversation not found",404);
  if(![true,1,"1"].includes(conversation.can_send)) throw new AppError("This conversation is read-only",409);
  const transaction=createTransaction(pool);
  let aborted=false;
  transaction.on("rollback",()=>{aborted=true;});
  await transaction.begin();
  let message,saved;
  try {
    saved=await messages.insertMessage(transaction,{conversationId,userId,body});
    const attachment=await attachments.insert(transaction,{conversationId,messageId:saved.message_id,file});
    message={conversation_id:saved.conversation_id,...messageOf(saved),attachments:[attachmentOf(attachment)]};
    await transaction.commit();
  } catch(error) {
    if(!aborted) try {await transaction.rollback();} catch(rollbackError){console.error("Message attachment rollback failed:",rollbackError);}
    throw error;
  }
  announce({clientId:saved.client_id,employerId:saved.employer_id},"message:new",message);
  return message;
};
export const makeAttachmentReader = ({messages=MessageModel,attachments=AttachmentModel}={}) => async (pool,{conversationId,attachmentId,userId}) => {
  const {conversation}=await messages.getConversationById(pool,conversationId,userId,{limit:1});
  if(!conversation)throw new AppError("Attachment not found",404);
  const file=await attachments.get(pool,conversationId,attachmentId);
  if(!file)throw new AppError("Attachment not found",404);
  return file;
};
export default { send: makeAttachmentSender(), get: makeAttachmentReader() };
