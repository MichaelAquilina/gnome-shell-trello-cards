import Soup from "gi://Soup";
import GLib from "gi://GLib";

// Glob pattern matching utility
export function matchesGlobPattern(text, pattern) {
  // Convert glob pattern to regex
  // Escape special regex characters except * and ?
  let regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    .replace(/\*/g, ".*") // * becomes .*
    .replace(/\?/g, "."); // ? becomes .

  // Make it case-insensitive and match the whole string
  const regex = new RegExp(`^${regexPattern}$`, "i");
  const result = regex.test(text);

  // Debug logging for pattern matching
  console.log(
    `Pattern match: "${text}" ${
      result ? "matches" : "does not match"
    } pattern "${pattern}"`,
  );

  return result;
}

export async function closeCard(cardId, apiKey, token) {
  console.log("Closing card", cardId);
  const url = `https://api.trello.com/1/cards/${cardId}/closed?token=${token}&key=${apiKey}`;
  const data = { value: true };
  return request("PUT", url, { data });
}

export async function fetchBoardLists(boardId, apiKey, token) {
  console.log("Fetching Board Lists for board:", boardId);
  const url = `https://api.trello.com/1/boards/${boardId}/lists?key=${apiKey}&token=${token}&cards=open`;
  try {
    const result = await request("GET", url);
    console.log(
      `Successfully fetched ${result.length} lists from board ${boardId}`,
    );
    return result;
  } catch (error) {
    console.error(
      `Failed to fetch lists from board ${boardId}:`,
      error.message,
    );
    throw new Error(
      `Failed to fetch lists from board ${boardId}: ${error.message}`,
    );
  }
}

export async function fetchAvailableLists(boardId, apiKey, token) {
  console.log("Fetching all available lists for board:", boardId);
  const url = `https://api.trello.com/1/boards/${boardId}/lists?key=${apiKey}&token=${token}`;
  try {
    const result = await request("GET", url);
    console.log(
      `Available lists in board ${boardId}:`,
      result.map((list) => `"${list.name}"`).join(", "),
    );
    return result;
  } catch (error) {
    console.error(
      `Failed to fetch available lists from board ${boardId}:`,
      error.message,
    );
    throw error;
  }
}

export async function validateBoardAccess(boardId, apiKey, token) {
  console.log("Validating access to board:", boardId);
  const url = `https://api.trello.com/1/boards/${boardId}?key=${apiKey}&token=${token}&fields=name,id`;
  try {
    const result = await request("GET", url);
    console.log(`Successfully validated board: ${result.name} (${result.id})`);
    return result;
  } catch (error) {
    console.error(`Failed to validate board ${boardId}:`, error.message);
    throw new Error(`Cannot access board ${boardId}: ${error.message}`);
  }
}

async function request(method, url, { data } = {}) {
  console.log(
    `Making ${method} request to: ${url
      .replace(/key=[^&]+/, "key=***")
      .replace(/token=[^&]+/, "token=***")}`,
  );

  try {
    let session = new Soup.Session();
    let message = Soup.Message.new(method, url);

    if (data) {
      const bytes = GLib.Bytes.new(JSON.stringify(data));
      message.set_request_body_from_bytes("application/json", bytes);
    }

    const bytes = await new Promise((resolve, reject) => {
      session.send_and_read_async(
        message,
        GLib.PRIORITY_DEFAULT,
        null,
        (session, result) => {
          try {
            const status = message.get_status();
            const bytes = session.send_and_read_finish(result);

            if (status !== Soup.Status.OK) {
              // Try to get error details from response body
              const decoder = new TextDecoder("utf-8");
              const errorResponse = decoder.decode(bytes.get_data());

              let errorMessage = `HTTP ${status}`;
              try {
                const errorData = JSON.parse(errorResponse);
                if (errorData.message) {
                  errorMessage += `: ${errorData.message}`;
                } else if (errorData.error) {
                  errorMessage += `: ${errorData.error}`;
                }
              } catch {
                // If response isn't JSON, include raw response
                if (errorResponse && errorResponse.length < 200) {
                  errorMessage += `: ${errorResponse}`;
                }
              }

              console.error(
                `Request failed with status ${status}:`,
                errorResponse,
              );
              reject(new Error(errorMessage));
              return;
            }

            resolve(bytes);
          } catch (e) {
            console.error("Request processing error:", e);
            reject(e);
          }
        },
      );
    });

    // Parse the response
    const decoder = new TextDecoder("utf-8");
    const response = decoder.decode(bytes.get_data());

    try {
      const result = JSON.parse(response);
      console.log(
        `Request successful, received ${
          Array.isArray(result) ? result.length + " items" : "data"
        }`,
      );
      return result;
    } catch (parseError) {
      console.error("Failed to parse JSON response:", response);
      throw new Error(`Invalid JSON response: ${parseError.message}`);
    }
  } catch (error) {
    console.error(`Request failed:`, error.message);
    throw error;
  }
}
