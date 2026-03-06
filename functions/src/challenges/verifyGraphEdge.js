/**
 * verifyGraphEdge.js
 * Cloud Function — HTTPS Callable
 *
 * Called when a user draws an edge on the investigation board.
 * Checks if the proposed connection exists in the challenge's solution graph.
 * Awards partial ELO on correct connections.
 *
 * Input:
 *   { challengeId, sourceType, sourceValue, targetType, targetValue, relationshipType }
 *
 * Output:
 *   { correct: bool, eloAwarded: number, totalCorrect: number, isComplete: bool }
 *
 * File location: functions/src/challenges/verifyGraphEdge.js
 */

"use strict";

const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ELO awarded per correct edge connection
const ELO_PER_EDGE = 2;

module.exports = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Login required.");
  }

  const userId = context.auth.uid;
  const { challengeId, sourceType, sourceValue, targetType, targetValue, relationshipType } = data;

  if (!challengeId || !sourceType || !sourceValue || !targetType || !targetValue || !relationshipType) {
    throw new functions.https.HttpsError("invalid-argument", "Missing required fields.");
  }

  // ── Fetch challenge ────────────────────────────────────────────────────────
  const challengeSnap = await db.collection("challenges").doc(challengeId).get();
  if (!challengeSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Challenge not found.");
  }

  const challenge = challengeSnap.data();
  if (challenge.type !== "investigation") {
    throw new functions.https.HttpsError("failed-precondition", "Not an investigation challenge.");
  }

  if (!challenge.isActive) {
    throw new functions.https.HttpsError("failed-precondition", "Challenge is not active.");
  }

  const solutionGraph = challenge.solutionGraph || { nodes: [], edges: [] };

  // ── Normalize comparison — case-insensitive, trimmed ─────────────────────
  const normalize = (s) => (s || "").toString().toLowerCase().trim();

  const nSourceType  = normalize(sourceType);
  const nSourceValue = normalize(sourceValue);
  const nTargetType  = normalize(targetType);
  const nTargetValue = normalize(targetValue);
  const nRelType     = normalize(relationshipType);

  // ── Check if this edge exists in the solution ─────────────────────────────
  const isCorrect = solutionGraph.edges.some(edge => {
    const sourceNode = solutionGraph.nodes.find(n => n.id === edge.source);
    const targetNode = solutionGraph.nodes.find(n => n.id === edge.target);
    if (!sourceNode || !targetNode) return false;

    return normalize(sourceNode.type)  === nSourceType
        && normalize(sourceNode.value) === nSourceValue
        && normalize(targetNode.type)  === nTargetType
        && normalize(targetNode.value) === nTargetValue
        && normalize(edge.relationship) === nRelType;
  });

  if (!isCorrect) {
    return { correct: false, eloAwarded: 0, totalCorrect: 0, isComplete: false };
  }

  // ── Track progress in activeSession ───────────────────────────────────────
  const sessionId  = `${userId}_${challengeId}`;
  const sessionRef = db.collection("activeSessions").doc(sessionId);

  const result = await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new functions.https.HttpsError("failed-precondition", "No active session.");
    }

    const session      = sessionSnap.data();
    const correctEdges = session.correctEdges || [];
    const edgeKey      = `${nSourceType}:${nSourceValue}->${nRelType}->${nTargetType}:${nTargetValue}`;

    // Idempotent — don't award ELO for already-verified edge
    if (correctEdges.includes(edgeKey)) {
      return { correct: true, eloAwarded: 0, totalCorrect: correctEdges.length, isComplete: false, alreadyVerified: true };
    }

    const updatedEdges  = [...correctEdges, edgeKey];
    const totalRequired = solutionGraph.edges.length;
    const totalCorrect  = updatedEdges.length;
    const isComplete    = totalCorrect >= totalRequired;

    // Update session
    tx.update(sessionRef, { correctEdges: updatedEdges });

    // Award partial ELO to user
    const userRef = db.collection("users").doc(userId);
    tx.update(userRef, {
      elo:        FieldValue.increment(ELO_PER_EDGE),
      weeklyElo:  FieldValue.increment(ELO_PER_EDGE),
      monthlyElo: FieldValue.increment(ELO_PER_EDGE),
    });

    return { correct: true, eloAwarded: ELO_PER_EDGE, totalCorrect, isComplete };
  });

  return result;
});