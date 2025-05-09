import Soup from 'gi://Soup';
import GLib from 'gi://GLib';

export async function closeCard(cardId, apiKey, token) {
    console.log("Closing card", cardId);
    const url = `https://api.trello.com/1/cards/${cardId}/closed?token=${token}&key=${apiKey}`;
    const data = {value: true};
    return request('PUT', url, {data})
}

export async function fetchBoardLists(boardId, apiKey, token) {
    console.log("Fetching Board List", boardId);
    const url = `https://api.trello.com/1/boards/${boardId}/lists?key=${apiKey}&token=${token}&cards=open`;
    return request('GET', url)
}

async function request(method, url, {data} = {}) {
    try {
        let session = new Soup.Session();
        let message = Soup.Message.new(method, url);

        if (data) {
            const bytes = GLib.Bytes.new(JSON.stringify(data));
            message.set_request_body_from_bytes('application/json', bytes);
        }
        const bytes = await new Promise((resolve, reject) => {
            session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                null,
                (session, result) => {
                    try {
                        const status = message.get_status();
                        if (status !== Soup.Status.OK) {
                            reject(new Error(`HTTP error ${status}`));
                            return;
                        }

                        const bytes = session.send_and_read_finish(result);
                        resolve(bytes);
                    } catch (e) {
                        reject(e);
                    }
                },
            );
        });
        // Parse the response
        const decoder = new TextDecoder('utf-8');
        const response = decoder.decode(bytes.get_data());
        const result = JSON.parse(response);
        return result;
    } catch(error) {
        console.error(error);
        throw error;
    }

}
