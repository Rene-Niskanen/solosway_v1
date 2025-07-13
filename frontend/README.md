# Solosway Frontend

React frontend for the Solosway property appraisal platform.

## Features

- **Current Appraisal View**: Interactive property appraisal interface with tabs
- **Chat Interface**: Real-time chat with AI agent
- **Comparable Properties**: Display and analyze comparable properties
- **Responsive Design**: Built with Tailwind CSS for mobile-friendly experience

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Flask backend running on `http://localhost:5000`

### Installation

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

The app will open at `http://localhost:3000`

### Building for Production

```bash
npm run build
```

## Project Structure

```
frontend/
├── public/
│   └── index.html          # Main HTML file
├── src/
│   ├── components/
│   │   ├── tabs/           # Tab components
│   │   │   ├── Overview.js
│   │   │   ├── MarketAnalysis.js
│   │   │   ├── Comparables.js
│   │   │   ├── ComparableAnalysis.js
│   │   │   └── MyReports.js
│   │   ├── CurrentAppraisal.js  # Main appraisal component
│   │   ├── Header.js            # Navigation header
│   │   ├── TabNavigation.js     # Tab navigation
│   │   └── ChatArea.js          # Chat interface
│   ├── App.js              # Main app component
│   ├── App.css             # App styles
│   ├── index.js            # Entry point
│   └── index.css           # Global styles
└── package.json            # Dependencies and scripts
```

## API Integration

The frontend communicates with the Flask backend through the following endpoints:

- `GET /api/appraisal/:id` - Fetch appraisal data
- `POST /api/appraisal/:id/chat` - Send chat message

## Technologies Used

- **React 18** - UI framework
- **React Router** - Client-side routing
- **Axios** - HTTP client
- **Tailwind CSS** - Styling framework
- **Chart.js** - Data visualization (for future use)

## Development

### Adding New Features

1. Create new components in the `src/components/` directory
2. Add routes in `App.js` if needed
3. Update the API calls to match your Flask backend

### Styling

The project uses Tailwind CSS for styling. Custom styles can be added to `src/index.css`.

## Deployment

This frontend is designed to be deployed on Vercel. The `proxy` setting in `package.json` will be ignored in production, so make sure to update the API base URL for your production backend. 