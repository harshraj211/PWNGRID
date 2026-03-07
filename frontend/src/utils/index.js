export const normalizeAnswer = (answer) => {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ')
}

export const formatDate = (date) => {
  return new Date(date).toLocaleDateString()
}

export const gravatarUrl = (email) => {
  const hash = email.trim().toLowerCase()
  return `https://www.gravatar.com/avatar/${hash}?d=identicon`
}

export const eloColor = (elo) => {
  if (elo < 1200) return '#888888'      // Gray
  if (elo < 1600) return '#4FC3F7'      // Blue
  if (elo < 2000) return '#66BB6A'      // Green
  if (elo < 2400) return '#FFA726'      // Orange
  return '#EF5350'                       // Red
}
