import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { forgetStashedAttribution, getSignupMarks, identifyUser, rememberSignupMarks, resetIdentity, track } from '@/lib/analytics';
import { marksToColumns, pickSignupMarks } from '@/lib/campaign';

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
  // repeat SIGNED_IN - which supabase-js emits every time the tab regains focus
  // - does NOT trigger another loadUserProfile()/isLoadingAuth flash that would
  // unmount the whole app and look like a full page "refresh" on tab switch.
  const loadedUserIdRef = React.useRef(null);
  // Set while a logout is in progress. The SIGNED_OUT handler keeps the spinner
  // up (instead of clearing isLoadingAuth) so the public landing doesn't flash
  // for ~0.5s between sign-out and the redirect to /login.
  const isLoggingOutRef = React.useRef(false);

  useEffect(() => {
    // Check if this is an OAuth callback (PKCE code in URL or implicit hash token).
    // In that case, don't clear the loading state from getSession() - wait for
    // onAuthStateChange to fire SIGNED_IN / INITIAL_SESSION with the real session.
    const isOAuthCallback =
      new URLSearchParams(window.location.search).has('code') ||
      window.location.hash.includes('access_token');

    // Primary: check session immediately - reliably handles page refresh
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        loadUserProfile(session.user);
      } else if (!isOAuthCallback) {
        // No session and not an OAuth callback - user is genuinely not logged in
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
          // Confirmed: no session - clear loading
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
        if (isLoggingOutRef.current) {
          // Keep the spinner up until logout()'s redirect to /login fires -           // prevents a flash of the public landing during sign-out.
          setIsLoadingAuth(true);
        } else {
          setIsLoadingAuth(false);
          setAuthChecked(true);
        }
      }
      // TOKEN_REFRESHED: session stays valid, no profile reload needed
    });

    return () => subscription.unsubscribe();
  }, []);

  // Background convergence of the cached `users` row (TRIP-135). isProActive(user)
  // — the client Pro verdict behind the badge + feature gates — reads THIS cached
  // copy, which is refreshed only by checkUserAuth, NOT by the entitlement webhook.
  // So after a background subscription change (cancel/renew/expiry) the cached row
  // lags until the next explicit refresh, while server-live reads (trip badges via
  // get_user_travel_stats) flip immediately → a visible desync (Pro badge gone from
  // trips, but the account still shows Pro) until a manual page reload.
  // Fix: silently re-sync the row on window focus (throttled), the same moment
  // react-query refetches its own focus-stale queries — so all client reads of Pro
  // converge together. Silent → no isLoadingAuth flash / app remount.
  useEffect(() => {
    let lastSync = 0;
    const resync = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastSync < 30_000) return; // throttle: at most once / 30s
      lastSync = now;
      checkUserAuth().catch(() => { /* non-fatal — reconcile-on-read covers it */ });
    };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);
    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', resync);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadUserProfile = async (authUser, { silent = false } = {}) => {
    // Prevent concurrent loads for the same user
    if (loadingForRef.current === authUser.id) return;
    loadingForRef.current = authUser.id;
    // Set by the PGRST116 branch below when THIS call inserted the profile row.
    let profileCreated = false;
    try {
      // A silent refresh (checkUserAuth after a profile save / avatar change /
      // Stripe-return entitlement poll) updates `user` in place WITHOUT flipping
      // isLoadingAuth. The whole authenticated tree is gated on isLoadingAuth in
      // App.jsx, so toggling it here unmounts+remounts the entire app — a visible
      // "full page refresh", and on the global Stripe-return handler it became an
      // infinite reload loop (the remount wipes that handler's run-once guard
      // while the stripe_status URL param is still present, so it re-fires
      // checkUserAuth on every remount forever).
      if (!silent) setIsLoadingAuth(true);

      // Fetch profile from public.users
      let { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (profile?.deleted_at) {
        // Account was anonymized/deleted server-side — force logout even if a
        // still-signed token is present in this tab/device (kills the zombie).
        await logout();
        return;
      }

      if (error && error.code === 'PGRST116') {
        // The marks this signup arrived with, from whichever carrier crossed the
        // border the visitor took: auth metadata for email (they survive
        // confirming on another device entirely), the sessionStorage stash for
        // OAuth. Resolved ONCE, here, and handed to both readers below — the
        // `users` columns and the campaign super-properties. Announcing them is
        // what gives last touch a value for someone who arrived marked, ignored
        // the cookie banner and signed in with Google (TRIP-335); doing it only
        // on this branch is what stops a year-old click resurrecting on a later
        // login, since the metadata live on the auth user forever.
        // `pickSignupMarks` is a whitelist, never a raw spread: `user_metadata`
        // is client-owned, so an unfiltered one would set any column.
        const signupMarks = pickSignupMarks(authUser.user_metadata?.signup_attribution)
          || getSignupMarks();
        rememberSignupMarks(signupMarks);

        // Profile doesn't exist yet - create it (first login via Google or email).
        // Avatar policy: keep ONLY a real uploaded/OAuth image. When there is
        // none, leave avatar_url null — <Avatar> renders a gradient fallback.
        // No generated placeholder image (single fallback, no third variant).
        const { data: newProfile, error: createError } = await supabase
          .from('users')
          .insert({
            id: authUser.id,
            email: authUser.email,
            full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
            avatar_url: authUser.user_metadata?.avatar_url || null,
            // Where this account came from (TRIP-311). WRITTEN here, at the one
            // birth point of a user — the same reason `user_signed_up` lives
            // here rather than in the login buttons. (Capturing the marks before
            // an OAuth redirect does have to happen per button: once the provider
            // replaces the document there is no choke point left.)
            // Account data, not tracking: recorded whatever the visitor answered
            // on the cookie banner. `utm_content` has no column and stops here —
            // it says which creative, which is ad reporting, not account data.
            ...(marksToColumns(signupMarks) || {}),
          })
          .select()
          .single();

        if (createError) throw createError;
        profile = newProfile;
        profileCreated = true;
      } else if (error) {
        throw error;
      } else {
        // Signing in to an existing account is not a signup, so the marks the
        // OAuth redirect carried have nothing to attribute. Dropping them here
        // stops them being inherited by whoever registers next in this tab.
        forgetStashedAttribution();
      }

      // avatar_url is passed through as stored — do NOT re-add a sanitizer here.
      // This path feeds only the header and the profile, while trip screens and
      // chat read the same column through resolveProfiles, so one user ended up
      // with two different avatars. Legacy dicebear placeholders are cleared in
      // the data instead (migration 20260725202621).
      setUser({ ...profile, id: authUser.id });
      setIsAuthenticated(true);
      if (!silent) setIsLoadingAuth(false);
      setAuthChecked(true);
      // Fed the PROFILE, on every load, not the marks freshly read at creation:
      // consent can arrive after the account exists (confirmation link opened on
      // a phone, or Google sign-in before answering the banner), and a reload in
      // between would lose an in-memory value for good. The column cannot be
      // lost, and set-once makes repeating it free. The campaign mark rides the
      // same call — see identifyUser, which owns all of it.
      identifyUser(authUser.id, profile);
      // Registration (TRIP-316 A1). The `users` row is the ONE birth point of a
      // user: it is created here, exactly once, and identically for Google,
      // Apple, One Tap and email — the login buttons are not, and the fourth one
      // would be forgotten the day it is added. Fires AFTER identify so the
      // event lands on the real person, not on the anonymous id. Email lands
      // here only after the confirmation link, so this counts confirmed
      // registrations — `signup_email_sent` covers the step before.
      // No `|| 'email'` fallback: GoTrue always sets the provider (checked on
      // prod), and a guess would quietly file a broken case under email instead
      // of showing up as an empty bucket worth looking at.
      if (profileCreated) {
        track('user_signed_up', { method: authUser.app_metadata?.provider });
      }
      // Mark this user as fully loaded so repeat SIGNED_IN events (tab refocus)
      // are ignored by the onAuthStateChange guard above.
      loadedUserIdRef.current = authUser.id;
    } catch (error) {
      console.error('Failed to load user profile:', error);
      // On a silent refresh, keep the current auth state untouched — a transient
      // profile-fetch blip must not flip the app to "loading" or sign the user
      // out; reconcile-on-read covers the missed refresh.
      if (!silent) {
        setAuthError({ type: 'unknown', message: error.message });
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    } finally {
      // Release the in-flight guard. It exists only to dedupe CONCURRENT loads
      // (SIGNED_IN + INITIAL_SESSION firing together on page load). If it stayed
      // pinned to the user id forever, a later checkUserAuth() - e.g. right after
      // saving the profile - would early-return and never re-fetch, so the updated
      // name never reached the context and looked like it "didn't save".
      loadingForRef.current = null;
    }
  };

  const checkUserAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      // Force a genuine re-fetch even if this user was already loaded once.
      loadingForRef.current = null;
      await loadUserProfile(session.user, { silent: true });
    }
  };

  const logout = async (shouldRedirect = true) => {
    // Flag the logout so the SIGNED_OUT listener holds the spinner instead of
    // rendering the landing. Show the spinner immediately, then sign out and
    // hard-redirect to /login - no landing flash in between.
    isLoggingOutRef.current = true;
    if (shouldRedirect) setIsLoadingAuth(true);
    resetIdentity();
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      window.location.replace('/login');
    } else {
      isLoggingOutRef.current = false;
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