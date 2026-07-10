/**
 * DeanOS Gmail forwarder — Google Apps Script (free, no Zapier).
 *
 * Polls the Gmail inbox every few minutes and POSTs new messages to the
 * DeanOS email webhook. Processed threads get the label "DeanOS-sent" so
 * nothing is sent twice (DeanOS is also idempotent by message ID).
 *
 * Setup (one time):
 *  1. Go to https://script.google.com while signed in to the Gmail account.
 *  2. New project → delete the sample code → paste this whole file.
 *  3. Replace WEBHOOK_SECRET below with the real DeanOS webhook secret.
 *  4. Run the function `setup` once (▶ button) and grant the permissions.
 *     That installs a trigger running `forwardNewMail` every 5 minutes.
 */

var WEBHOOK_URL = "https://deanos-nu.vercel.app/api/webhooks/zapier/email";
var WEBHOOK_SECRET = "PASTE-THE-DEANOS-WEBHOOK-SECRET-HERE";
var PROCESSED_LABEL = "DeanOS-sent";
var MAILBOX = "personal";

function setup() {
  // Clear any previous triggers for this handler, then install a 5-minute one.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "forwardNewMail") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("forwardNewMail").timeBased().everyMinutes(5).create();
  GmailApp.createLabel(PROCESSED_LABEL);
  forwardNewMail();
}

function forwardNewMail() {
  var label = GmailApp.createLabel(PROCESSED_LABEL); // returns existing if present
  // Recent inbox threads not yet forwarded. newer_than keeps the search fast.
  var threads = GmailApp.search('in:inbox newer_than:2d -label:"' + PROCESSED_LABEL + '"', 0, 20);

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (message.getDate().getTime() < Date.now() - 2 * 24 * 60 * 60 * 1000) return;
      var payload = {
        mailbox: MAILBOX,
        from: message.getFrom(),
        to: message.getTo(),
        subject: message.getSubject(),
        body: message.getPlainBody().slice(0, 20000),
        date: message.getDate().toISOString(),
        message_id: message.getHeader("Message-ID") || "gmail-" + message.getId(),
        threadId: thread.getId(),
        sourceUrl: "https://mail.google.com/mail/u/0/#inbox/" + message.getId(),
      };
      var response = UrlFetchApp.fetch(WEBHOOK_URL, {
        method: "post",
        contentType: "application/json",
        headers: { "X-DeanOS-Secret": WEBHOOK_SECRET },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      if (response.getResponseCode() >= 400) {
        console.error("DeanOS webhook error " + response.getResponseCode() + ": " + response.getContentText().slice(0, 200));
      }
    });
    thread.addLabel(label);
  });
}
