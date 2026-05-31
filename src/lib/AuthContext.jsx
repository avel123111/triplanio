import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Prevent race condition: track which user ID is currently being loaded
  const loadingForRef = React.useRef(null);
  // Track which user's profile is already loaded & live. Unlike loadingForRef
  // (an in-flight guard that gets cleared in finally), this persists so that a
  // repeat SIGNED_IN — which supabase-js emits every time the tab regains focus
  // — does NOT trigger another loadUserProfile()/isLoadingAuth flash that would
  // unmount the whole app and look like a full page "refresh" on tab switch.
  const loadedUserIdRef = React.useRef(null);

  useEffect(() => {
    // Check if this is an OAuth callback (PKCE code in URL or implicit hash token).
    // In that case, don't clear the loading state from getSession() — wait for
    // onAuthStateChange to fire SIGNED_IN / INITIAL_SESSION with the real session.
    const isOAuthCallback =
      new URLSearchParams(window.location.search).has('code') ||
      window.location.hash.includes('access_token');

    // Primary: check session immediately — reliably handles page refresh
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        loadUserProfile(session.user);
      } else if (!isOAuthCallback) {
        // No session and not an OAuth callback — user is genuinely not logged in
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
      // If isOAuthCallback and no session yet: code exchange is still in-flight.
      // Keep isLoadingAuth=true and let onAuthStateChange handle it below.
    });

    // Secondary: react to auth changes (sign-in, sign-out, OAuth callback, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        // Skip when this user's profile is already loaded (the common case on
        // tab refocus) or a load for them is already in flight. Without this,
        // every tab focus reloaded the profile → isLoadingAuth flash → remount.
        if (loadedUserIdRef.current !== session.user.id &&
            loadingForRef.current !== session.user.id) {
          loadUserProfile(session.user);
        }
      } else if (event === 'INITIAL_SESSION') {
        // Fired on page load with the resolved session (covers OAuth callback exchange)
        if (session) {
          if (loadedUserIdRef.current !== session.user.id &&
              loadingForRef.current !== session.user.id) {
            loadUserProfile(session.user);
          }
        } else {
          // Confirmed: no session — clear loading
          setUser(null);
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
          setAuthChecked(true);
        }
      } else if (event === 'SIGNED_OUT') {
        loadingForRef.current = null;
        loadedUserIdRef.current = null;
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
      // TOKEN_REFRESHED: session stays valid, no profile reload needed
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (authUser) => {
    // Prevent concurrent loads for the same user
    if (loadingForRef.current === authUser.id) return;
    loadingForRef.current = authUser.id;
    try {
      setIsLoadingAuth(true);

      // Fetch profile from public.users
      let { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // Profile doesn't exist yet — create it (first login via Google or email)
        const seed = encodeURIComponent(
          authUser.user_metadata?.full_name ||
          authUser.user_metadata?.name ||
          authUser.email || 'user'
        );
        const avatarUrl = authUser.user_metadata?.avatar_url ||
          `https://api.dicebear.com/7.x/initials/svg?seed=${seed}`;

        const { data: newProfile, error: createError } = await supabase
          .from('users')
          .insert({
            id: authUser.id,
            email: authUser.email,
            full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
            avatar_url: avatarUrl,
          })
          .select()
          .single();

        if (createError) throw createError;
        profile = newProfile;
      } else if (error) {
        throw error;
      }

      // Backfill avatar if missing
      if (profile && !profile.avatar_url) {
        const seed = encodeURIComponent(profile.full_name || profile.email || 'user');
        const defaultAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${seed}`;
        await supabase.from('users').update({ avatar_url: defaultAvatar }).eq('id', authUser.id);
        profile.avatar_url = defaultAvatar;
      }

      setUser({ ...profile, id: authUser.id });
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      // Mark this user as fully loaded so repeat SIGNED_IN events (tab refocus)
      // are ignored by the onAuthStateChange guard above.
      loadedUserIdRef.current = authUser.id;
    } catch (error) {
      console.error('Failed to load user profile:', error);
      setAuthError({ type: 'unknown', message: error.message });
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    } finally {
      // Release the in-flight guard. It exists only to dedupe CONCURRENT loads
      // (SIGNED_IN + INITIAL_SESSION firing together on page load). If it stayed
      // pinned to the user id forever, a later checkUserAuth() — e.g. right after
      // saving the profile — would early-return and never re-fetch, so the updated
      // name never reached the context and looked like it "didn't save".
      loadingForRef.current = null;
    }
  };

  const checkUserAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // Force a genuine re-fetch even if this user was already loaded once.
      loadingForRef.current = null;
      await loadUserProfile(session.user);
    }
  };

  const logout = async (shouldRedirect = true) => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      window.location.href = '/login';
    }
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,  // kept for interface compatibility
      authError,
      appPublicSettings: null,          // kept for interface compatibility
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth,     // alias for interface compatibility
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};