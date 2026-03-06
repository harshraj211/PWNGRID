/**
 * RaceChart.jsx
 * Live line chart showing cumulative scores of top participants over time.
 * Subscribes to contestSubmissions for real-time updates.
 *
 * File location: frontend/src/components/contest/RaceChart.jsx
 */
import { useState, useEffect, useMemo } from "react";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase/config";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

const COLORS = [
  "#00ff88", "#00bfff", "#ff4d4d", "#ff9500",
  "#a855f7", "#f472b6", "#facc15", "#34d399",
  "#60a5fa", "#fb923c",
];

export default function RaceChart({ contestId, startMs, endMs }) {
  const [submissions, setSubmissions] = useState([]);

  // Live subscription to correct submissions
  useEffect(() => {
    if (!contestId) return;
    const q = query(
      collection(db, "contestSubmissions"),
      where("contestId", "==", contestId),
      where("isCorrect", "==", true),
      orderBy("timestamp", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setSubmissions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [contestId]);

  // Build chart data: for each submission timestamp, compute cumulative score per user
  const { chartData, usernames } = useMemo(() => {
    if (submissions.length === 0) return { chartData: [], usernames: [] };

    // Group by user, compute cumulative
    const userScores = {};  // userId -> [{time, cumScore}]
    const usernameMap = {}; // userId -> username (from participant or fallback)

    // Sort by timestamp
    const sorted = [...submissions].sort((a, b) => {
      const aMs = a.timestamp?.toMillis?.() ?? 0;
      const bMs = b.timestamp?.toMillis?.() ?? 0;
      return aMs - bMs;
    });

    // Compute cumulative per user
    sorted.forEach(sub => {
      const uid = sub.userId;
      if (!usernameMap[uid]) usernameMap[uid] = sub.username || uid.slice(0, 8);
      if (!userScores[uid]) userScores[uid] = 0;
      userScores[uid] += 1; // count correct solves
    });

    // We need time-series data: at each timestamp, what is each user's cumulative count
    const runningScores = {};
    const timePoints = [];

    // Start point
    const dataPointStart = { time: 0 };

    sorted.forEach(sub => {
      const uid = sub.userId;
      const ts = sub.timestamp?.toMillis?.() ?? 0;
      const minutesFromStart = Math.max(0, Math.round((ts - startMs) / 60000));

      if (!runningScores[uid]) runningScores[uid] = 0;
      runningScores[uid] += 1;

      const point = { time: minutesFromStart };
      // Copy all running scores
      Object.keys(runningScores).forEach(u => {
        point[u] = runningScores[u];
      });
      timePoints.push(point);
    });

    // Determine top 10 users by final score
    const finalScores = Object.entries(runningScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const topUserIds = finalScores.map(([uid]) => uid);
    const topUsernames = topUserIds.map(uid => usernameMap[uid] || uid.slice(0, 8));

    // Fill forward: at each time point, carry forward previous values for users not present
    const filledData = [{ time: 0 }];
    const lastKnown = {};
    topUserIds.forEach(uid => { lastKnown[uid] = 0; filledData[0][uid] = 0; });

    timePoints.forEach(pt => {
      const filled = { time: pt.time };
      topUserIds.forEach(uid => {
        if (pt[uid] !== undefined) lastKnown[uid] = pt[uid];
        filled[uid] = lastKnown[uid] || 0;
      });
      filledData.push(filled);
    });

    return {
      chartData: filledData,
      usernames: topUserIds.map((uid, i) => ({
        uid,
        name: topUsernames[i],
        color: COLORS[i % COLORS.length],
      })),
    };
  }, [submissions, startMs]);

  if (submissions.length === 0) {
    return (
      <div style={{ padding: "16px 0", color: "var(--color-text-muted)", fontSize: 13, textAlign: "center" }}>
        No solves yet — chart will appear as participants solve challenges.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 260 }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: -20 }}>
          <XAxis
            dataKey="time"
            type="number"
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
            tickFormatter={v => `${v}m`}
            stroke="var(--color-border)"
          />
          <YAxis
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
            allowDecimals={false}
            stroke="var(--color-border)"
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--color-text)",
            }}
            labelFormatter={v => `${v} min`}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "var(--color-text-muted)" }}
          />
          {usernames.map(({ uid, name, color }) => (
            <Line
              key={uid}
              type="monotone"
              dataKey={uid}
              name={name}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
