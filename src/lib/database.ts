import { db } from './firebase.ts';
import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from 'firebase/firestore';

export interface GroupData {
    [key: string]: any;
}

export interface UserData {
    [key: string]: any;
}

export interface BotSettings {
    autoRead: boolean;
    autoTyping: boolean;
    [key: string]: any;
}

export const getDatabase = () => {
    return {
        getGroup: async (jid: string): Promise<GroupData> => {
            const docRef = doc(db, 'groups', jid);
            const docSnap = await getDoc(docRef);
            return (docSnap.exists() ? docSnap.data() : {}) as GroupData;
        },
        getAllGroups: async (): Promise<GroupData[]> => {
            const groupsCol = collection(db, 'groups');
            const groupSnapshot = await getDocs(groupsCol);
            return groupSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as GroupData[];
        },
        setGroup: async (jid: string, data: Partial<GroupData>) => {
            const docRef = doc(db, 'groups', jid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                await updateDoc(docRef, data);
            } else {
                await setDoc(docRef, data);
            }
        },
        getUser: async (jid: string): Promise<UserData> => {
            const docRef = doc(db, 'users', jid);
            const docSnap = await getDoc(docRef);
            return (docSnap.exists() ? docSnap.data() : {}) as UserData;
        },
        setUser: async (jid: string, data: Partial<UserData>) => {
            const docRef = doc(db, 'users', jid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                await updateDoc(docRef, data);
            } else {
                await setDoc(docRef, data);
            }
        },
        getSettings: async (): Promise<BotSettings> => {
            const docRef = doc(db, 'settings', 'bot');
            const docSnap = await getDoc(docRef);
            return (docSnap.exists() ? docSnap.data() : { autoRead: false, autoTyping: false }) as BotSettings;
        },
        setSettings: async (data: Partial<BotSettings>) => {
            const docRef = doc(db, 'settings', 'bot');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                await updateDoc(docRef, data);
            } else {
                await setDoc(docRef, data);
            }
        },
        data: null // Firestore doesn't hold all data in memory
    };
};
