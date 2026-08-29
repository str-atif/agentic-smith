export const SUGGESTED_PROMPTS = [
  "Put a spawn point in the center of the current map",
  "What tools do I have available right now?",
  "What is in the current scene?",
];

function EmptyState({
  craftlandConnected,
}: {
  craftlandConnected: boolean;
  onPrompt?: (prompt: string) => void;
}): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-hero">
        <h1>What are we building?</h1>
        <p>
          Describe a change to your Craftland project and the agent will inspect the scene,
          call the right tools, and iterate until it is done.
          {craftlandConnected
            ? " Craftland tools are live."
            : " Start Craftland Studio to unlock its agent tools."}
        </p>
      </div>
    </div>
  );
}

export default EmptyState;